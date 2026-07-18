import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  calculateIpnMonth,
  calculateLatePenalty,
  calculateVatThreshold,
  Money,
  type Result,
} from '@sana/domain';
import {
  buildPayrollLawParams,
  buildPenaltyLawParams,
  buildRuleLawParams,
  createSeededStore,
} from '@sana/legal-params';
import type { ApiContext } from './context';

/**
 * Калькуляторы (§11): та же логика, что и в основном движке —
 * ИПН через cumulativeIpn зарплатного движка, порог НДС той же функцией,
 * что правило Sana Guard, пеня по параметрам legal-params.
 */

const t = initTRPC.context<ApiContext>().create();

function money(m: Money): { tiyn: string; tenge: string } {
  return { tiyn: m.amount.toString(), tenge: m.toDecimalString() };
}

function unwrapOr400<T>(r: Result<T, { message: string }>): T {
  if (!r.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: r.error.message });
  return r.value;
}

const tenge = z.number().int().nonnegative();

export const calculatorsRouter = t.router({
  /** ИПН сотрудника нарастающим итогом (та же функция, что в §6). */
  ipn: t.procedure
    .input(z.object({ доходСНачалаГодаТенге: tenge, начислениеМесяцаТенге: tenge }))
    .query(({ ctx, input }) => {
      const params = buildPayrollLawParams(createSeededStore(), ctx.today);
      if (!params.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры не собраны' });
      const calc = unwrapOr400(
        calculateIpnMonth(
          Money.ofMajor(input.доходСНачалаГодаТенге),
          Money.ofMajor(input.начислениеМесяцаТенге),
          params.value,
        ),
      );
      return {
        ипнМесяца: money(calc.ipnMonth),
        накопленоБазыПосле: money(calc.cumTaxableAfter),
        накопленоИпнПосле: money(calc.cumIpnAfter),
        потолок1йСтупени: money(calc.bracketCeiling),
        пересеченПотолок: calc.crossedCeiling,
        норма: 'ст. 320 НК РК — ИПН нарастающим итогом с начала года',
        версияПараметров: calc.paramsVersion,
      };
    }),

  /** Порог обязательной регистрации по НДС — той же функцией, что Sana Guard. */
  vatThreshold: t.procedure
    .input(z.object({ оборотСНачалаГодаТенге: tenge }))
    .query(({ ctx, input }) => {
      const law = buildRuleLawParams(createSeededStore(), ctx.today);
      if (!law.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры не собраны' });
      const calc = unwrapOr400(
        calculateVatThreshold(Money.ofMajor(input.оборотСНачалаГодаТенге), {
          mrp: law.value.mrp,
          thresholdMrp: law.value.vatRegistrationThresholdMrp,
        }),
      );
      return {
        порог: money(calc.threshold),
        осталосьДоПорога: money(calc.remaining),
        превышение: money(calc.excess),
        порогПревышен: calc.breached,
        занятоПроцентов: calc.usedPercent,
        днейНаЗаявление: law.value.vatRegistrationApplicationWorkingDays,
        норма: 'ст. 99 НК РК — порог 10 000 МРП, заявление за 5 рабочих дней',
        версияПараметров: law.value.version,
      };
    }),

  /** Пеня за просрочку уплаты налога. */
  penalty: t.procedure
    .input(z.object({ суммаНалогаТенге: tenge, днейПросрочки: z.number().int().nonnegative() }))
    .query(({ ctx, input }) => {
      const params = buildPenaltyLawParams(createSeededStore(), ctx.today);
      if (!params.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры не собраны' });
      const calc = unwrapOr400(
        calculateLatePenalty(Money.ofMajor(input.суммаНалогаТенге), input.днейПросрочки, params.value),
      );
      return {
        пеня: money(calc.penalty),
        эффективнаяГодоваяСтавка: calc.effectiveAnnualRate.toPercentString(),
        норма: 'ст. 104 НК РК — 1,25-кратная базовая ставка НБ РК за каждый день',
        версияПараметров: calc.paramsVersion,
      };
    }),
});
