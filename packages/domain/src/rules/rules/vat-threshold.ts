import type { LocalDate } from '../../kernel/local-date';
import { Money } from '../../kernel/money';
import { Rate } from '../../kernel/rate';
import type { CompanyContext } from '../context';
import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

/**
 * Порог обязательной регистрации по НДС (ст. 99 НК РК): 10 000 МРП
 * облагаемого оборота нарастающим итогом за календарный год.
 * После превышения — заявление в течение 5 рабочих дней.
 */

/** Оборот по реализации за календарный год asOf (не отменённые исходящие ЭСФ). */
export function yearTurnover(ctx: CompanyContext, asOf: LocalDate): Money {
  return ctx.invoices
    .filter(
      (inv) =>
        inv.direction === 'OUT' &&
        inv.status !== 'АННУЛИРОВАН' &&
        inv.status !== 'ОТОЗВАН' &&
        inv.turnoverDate.year === asOf.year &&
        !inv.turnoverDate.isAfter(asOf),
    )
    .reduce((acc, inv) => acc.add(inv.totalExVat), Money.zero());
}

const APPROACHING_SHARE = Rate.percent(80);
const EXCESS_EXPOSURE_RATE = Rate.percent(15);

const APPROACHING_ID = 'VAT_THRESHOLD_APPROACHING';
const BREACHED_ID = 'VAT_THRESHOLD_BREACHED';
const NORM = 'ст. 99 НК РК';

export const vatThresholdApproaching = defineRule({
  id: APPROACHING_ID,
  severity: 'HIGH',
  norm: NORM,
  evaluate: (ctx, asOf) => {
    if (ctx.company.vatStatus.registered) return [];
    const turnover = yearTurnover(ctx, asOf);
    const threshold = ctx.law.mrp.multiply(ctx.law.vatRegistrationThresholdMrp);
    const eighty = threshold.percent(APPROACHING_SHARE);
    if (turnover.compareTo(eighty) < 0 || turnover.compareTo(threshold) >= 0) return [];
    const fine = ctx.law.mrp.multiply(ctx.law.fineVatRegistrationMrp);
    return [
      makeFinding(ctx, asOf, {
        ruleId: APPROACHING_ID,
        severity: 'HIGH',
        norm: NORM,
        subjectId: `${asOf.year}`,
        exposure: fine,
        message: `Оборот с начала года ${formatTenge(turnover)} — уже ${'≥'} 80% порога регистрации по НДС (${formatTenge(threshold)}). После превышения на подачу заявления будет ${ctx.law.vatRegistrationApplicationWorkingDays} рабочих дней; опоздание — штраф ${formatTenge(fine)} и 15% с облагаемого оборота.`,
        sourceDocuments: [{ system: 'SANA', documentType: 'регистр оборота', documentId: `turnover-${asOf.year}` }],
        remediation: {
          kind: 'PREPARE_VAT_REGISTRATION',
          description: 'Подготовить заявление о постановке на учёт по НДС',
          autonomyLevel: 'A1',
        },
      }),
    ];
  },
});

export const vatThresholdBreached = defineRule({
  id: BREACHED_ID,
  severity: 'CRITICAL',
  norm: NORM,
  evaluate: (ctx, asOf) => {
    if (ctx.company.vatStatus.registered) return [];
    const turnover = yearTurnover(ctx, asOf);
    const threshold = ctx.law.mrp.multiply(ctx.law.vatRegistrationThresholdMrp);
    if (turnover.compareTo(threshold) < 0) return [];
    const excess = turnover.subtract(threshold);
    const exposure = ctx.law.mrp
      .multiply(ctx.law.fineVatRegistrationMrp)
      .add(excess.percent(EXCESS_EXPOSURE_RATE));
    return [
      makeFinding(ctx, asOf, {
        ruleId: BREACHED_ID,
        severity: 'CRITICAL',
        norm: NORM,
        subjectId: `${asOf.year}`,
        exposure,
        message: `Порог регистрации по НДС превышен: оборот ${formatTenge(turnover)} при пороге ${formatTenge(threshold)}. Заявление — в течение ${ctx.law.vatRegistrationApplicationWorkingDays} рабочих дней. Под риском ${formatTenge(exposure)} (штраф 50 МРП + 15% оборота сверх порога).`,
        sourceDocuments: [{ system: 'SANA', documentType: 'регистр оборота', documentId: `turnover-${asOf.year}` }],
        remediation: {
          kind: 'SUBMIT_VAT_REGISTRATION',
          description: 'Подать заявление о постановке на учёт по НДС (требуется ЭЦП)',
          autonomyLevel: 'A1',
        },
      }),
    ];
  },
});
