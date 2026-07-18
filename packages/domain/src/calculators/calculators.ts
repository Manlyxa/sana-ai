import { Money } from '../kernel/money';
import { Rate } from '../kernel/rate';
import { err, ok, type Result } from '../kernel/result';
import { cumulativeIpn } from '../payroll/engine';
import type { PayrollLawParams } from '../payroll/params';

/**
 * Калькуляторы (§11, экран «Калькуляторы»): три чистые функции,
 * которые считают ТОЙ ЖЕ логикой, что и основной движок:
 *  - ИПН — через cumulativeIpn зарплатного движка (§6);
 *  - порог НДС — общая функция, её же использует правило Sana Guard
 *    vat-threshold (ст. 99 НК РК);
 *  - пеня — по параметрам из legal-params (базовая ставка НБ РК × 1,25).
 * Дублировать формулы запрещено: калькулятор, разошедшийся с движком,
 * хуже, чем его отсутствие.
 */

export type CalculatorError = { readonly message: string };

// ---------------------------------------------------------------------------
// ИПН нарастающим итогом
// ---------------------------------------------------------------------------

export type IpnMonthCalculation = {
  /** Накопительная облагаемая база до месяца / после месяца. */
  readonly cumTaxableBefore: Money;
  readonly cumTaxableAfter: Money;
  /** Накопительный ИПН до месяца / после месяца (той же функцией, что движок). */
  readonly cumIpnBefore: Money;
  readonly cumIpnAfter: Money;
  /** ИПН к удержанию за месяц = Δ накопительного. */
  readonly ipnMonth: Money;
  /** Потолок 1-й ступени (8500 МРП) и факт его пересечения в этом месяце. */
  readonly bracketCeiling: Money;
  readonly crossedCeiling: boolean;
  readonly paramsVersion: string;
};

/**
 * ИПН месяца нарастающим итогом: налог со всей базы с начала года минус
 * уже удержанное. Вход — облагаемая база (после ОПВ/ВОСМС и вычетов).
 */
export function calculateIpnMonth(
  cumTaxableBefore: Money,
  taxableThisMonth: Money,
  params: PayrollLawParams,
): Result<IpnMonthCalculation, CalculatorError> {
  if (cumTaxableBefore.isNegative() || taxableThisMonth.isNegative()) {
    return err({ message: 'облагаемая база не может быть отрицательной' });
  }
  const cumTaxableAfter = cumTaxableBefore.add(taxableThisMonth);
  const cumIpnBefore = cumulativeIpn(cumTaxableBefore, params);
  const cumIpnAfter = cumulativeIpn(cumTaxableAfter, params);
  const bracketCeiling = params.mrp.multiply(params.ipn.bracket1CeilingMrp);
  return ok({
    cumTaxableBefore,
    cumTaxableAfter,
    cumIpnBefore,
    cumIpnAfter,
    ipnMonth: cumIpnAfter.subtract(cumIpnBefore),
    bracketCeiling,
    crossedCeiling:
      cumTaxableBefore.compareTo(bracketCeiling) < 0 && cumTaxableAfter.compareTo(bracketCeiling) > 0,
    paramsVersion: params.version,
  });
}

// ---------------------------------------------------------------------------
// Порог обязательной регистрации по НДС (ст. 99 НК РК)
// ---------------------------------------------------------------------------

export type VatThresholdParams = {
  readonly mrp: Money;
  /** Порог в МРП (10 000, ст. 99 НК РК). */
  readonly thresholdMrp: number;
};

export type VatThresholdCalculation = {
  readonly turnover: Money;
  readonly threshold: Money;
  /** Сколько осталось до порога (0, если превышен). */
  readonly remaining: Money;
  /** Превышение сверх порога (0, если не превышен). */
  readonly excess: Money;
  readonly breached: boolean;
  /** Занятая доля порога в целых процентах (для «87% порога»). */
  readonly usedPercent: number;
};

/**
 * Статус порога НДС. Эту же функцию использует правило Sana Guard
 * vat-threshold — цифры калькулятора и ленты рисков совпадают по построению.
 */
export function calculateVatThreshold(
  turnover: Money,
  params: VatThresholdParams,
): Result<VatThresholdCalculation, CalculatorError> {
  if (turnover.isNegative()) return err({ message: 'оборот не может быть отрицательным' });
  const threshold = params.mrp.multiply(params.thresholdMrp);
  if (!threshold.isPositive()) return err({ message: 'порог должен быть положительным' });
  const zero = Money.zero(turnover.currency);
  const breached = turnover.compareTo(threshold) >= 0;
  const usedPercent = Number((turnover.amount * 100n) / threshold.amount);
  return ok({
    turnover,
    threshold,
    remaining: breached ? zero : threshold.subtract(turnover),
    excess: breached ? turnover.subtract(threshold) : zero,
    breached,
    usedPercent,
  });
}

// ---------------------------------------------------------------------------
// Пеня за просрочку уплаты налога
// ---------------------------------------------------------------------------

export type PenaltyLawParams = {
  /** Базовая ставка НБ РК, годовая. */
  readonly annualBaseRate: Rate;
  /** Кратность к базовой ставке (1,25 = 125%). */
  readonly multiplier: Rate;
  readonly version: string;
};

export type PenaltyCalculation = {
  readonly taxDue: Money;
  readonly daysLate: number;
  /** Эффективная годовая ставка = базовая × кратность. */
  readonly effectiveAnnualRate: Rate;
  readonly penalty: Money;
  readonly paramsVersion: string;
};

/**
 * Пеня = недоимка × (базовая ставка × 1,25) × дни / 365, в целых тенге.
 * Ставки — точные рациональные (Rate), никакого float.
 */
export function calculateLatePenalty(
  taxDue: Money,
  daysLate: number,
  params: PenaltyLawParams,
): Result<PenaltyCalculation, CalculatorError> {
  if (taxDue.isNegative()) return err({ message: 'сумма недоимки не может быть отрицательной' });
  if (!Number.isInteger(daysLate) || daysLate < 0) {
    return err({ message: `дни просрочки — целое неотрицательное число, получено: ${daysLate}` });
  }
  const base = params.annualBaseRate;
  const mult = params.multiplier;
  const effectiveAnnualRate = Rate.fraction(base.numerator * mult.numerator, base.denominator * mult.denominator);
  const effectiveForDays = Rate.fraction(
    effectiveAnnualRate.numerator * BigInt(daysLate),
    effectiveAnnualRate.denominator * 365n,
  );
  return ok({
    taxDue,
    daysLate,
    effectiveAnnualRate,
    penalty: taxDue.percent(effectiveForDays).roundToMajor(),
    paramsVersion: params.version,
  });
}
