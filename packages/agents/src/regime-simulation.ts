import { err, Money, ok, Rate, type Result } from '@sana/domain';

/**
 * Детерминированная симуляция ОУР vs СНР-упрощёнка (P1: считает КОД, не LLM).
 * Модель сознательно упрощена и документирована; LLM (RegimeAdvisor) только
 * рассуждает над готовыми числами.
 *
 * Допущения модели:
 * - КПН (ОУР) = ставка × (выручка − документированные расходы), не ниже нуля;
 * - НДС нетто (ОУР) = ставка × (выручка − расходы с НДС); считаем, что все
 *   документированные расходы содержат входной НДС;
 * - упрощёнка = ставка × выручка; недоступна, если годовая выручка превышает
 *   лимит в МРП (проверяется на каждый год горизонта);
 * - зарплатные налоги в обоих режимах примерно равны и в сравнение не входят.
 */

export type RegimeSimulationParams = {
  readonly mrp: Money;
  readonly kpnRate: Rate;
  readonly vatRate: Rate;
  readonly snrRate: Rate;
  readonly snrAnnualIncomeLimitMrp: number;
  readonly paramsVersion: string;
};

export type RegimeSimulationInput = {
  readonly monthlyRevenue: Money;
  /** Доля документально подтверждённых расходов в выручке (0..1). */
  readonly deductibleExpenseShare: Rate;
  /** Доля покупателей-плательщиков НДС (важно: на упрощёнке они теряют зачёт). */
  readonly vatPayerCustomerShare: Rate;
  readonly horizonMonths: number;
};

export type RegimeCost = {
  readonly kpnTiyn: string;
  readonly vatNetTiyn: string;
  readonly snrTaxTiyn: string;
  readonly totalTiyn: string;
};

export type RegimeSimulationResult = {
  readonly horizonMonths: number;
  readonly our: { readonly kpn: Money; readonly vatNet: Money; readonly total: Money };
  readonly uproshchenka: {
    readonly available: boolean;
    readonly unavailableReason: string | null;
    readonly tax: Money;
  };
  readonly cheaper: 'ОУР' | 'СНР_УПРОЩЁНКА' | 'НЕТ_ВЫБОРА';
  readonly savings: Money;
  /** Выручка покупателей-плательщиков НДС за горизонт — теряемый ими зачёт. */
  readonly customerVatCreditAtRisk: Money;
  readonly paramsVersion: string;
};

export function simulateRegimes(
  input: RegimeSimulationInput,
  params: RegimeSimulationParams,
): Result<RegimeSimulationResult, { message: string }> {
  if (input.horizonMonths < 1 || input.horizonMonths > 60) {
    return err({ message: 'горизонт симуляции — от 1 до 60 месяцев' });
  }
  if (input.monthlyRevenue.isNegative()) {
    return err({ message: 'выручка не может быть отрицательной' });
  }

  const revenue = input.monthlyRevenue.multiply(input.horizonMonths);
  const expenses = revenue.percent(input.deductibleExpenseShare);

  // ОУР
  const kpnBase = Money.max(revenue.subtract(expenses), Money.zero());
  const kpn = kpnBase.percent(params.kpnRate).roundToMajor();
  const vatOut = revenue.percent(params.vatRate);
  const vatIn = expenses.percent(params.vatRate);
  const vatNet = Money.max(vatOut.subtract(vatIn), Money.zero()).roundToMajor();
  const ourTotal = kpn.add(vatNet);

  // СНР-упрощёнка: годовой лимит
  const annualRevenue = input.monthlyRevenue.multiply(12);
  const limit = params.mrp.multiply(params.snrAnnualIncomeLimitMrp);
  const available = annualRevenue.compareTo(limit) <= 0;
  const snrTax = available ? revenue.percent(params.snrRate).roundToMajor() : Money.zero();

  const cheaper = !available
    ? ('НЕТ_ВЫБОРА' as const)
    : snrTax.compareTo(ourTotal) <= 0
      ? ('СНР_УПРОЩЁНКА' as const)
      : ('ОУР' as const);
  const savings = !available
    ? Money.zero()
    : (cheaper === 'СНР_УПРОЩЁНКА' ? ourTotal.subtract(snrTax) : snrTax.subtract(ourTotal));

  return ok({
    horizonMonths: input.horizonMonths,
    our: { kpn, vatNet, total: ourTotal },
    uproshchenka: {
      available,
      unavailableReason: available
        ? null
        : `годовая выручка ${annualRevenue.toDecimalString()} ₸ превышает лимит ${limit.toDecimalString()} ₸ (${params.snrAnnualIncomeLimitMrp} МРП)`,
      tax: snrTax,
    },
    cheaper,
    savings,
    customerVatCreditAtRisk: revenue
      .percent(input.vatPayerCustomerShare)
      .percent(params.vatRate)
      .roundToMajor(),
    paramsVersion: params.paramsVersion,
  });
}
