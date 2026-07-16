import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

const ID = 'UNCLEARED_ADVANCE';
const NORM = 'НК РК — доход физического лица (незакрытый подотчёт)';

/**
 * Подотчётная сумма не закрыта более 3 лет → признаётся доходом физлица.
 * Экспозиция — ИПН 10% с суммы (плюс соцплатежи при доначислении).
 */
export const unclearedAdvance = defineRule({
  id: ID,
  severity: 'HIGH',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.advances
      .filter((a) => a.clearedAt === null && asOf.isAfter(a.issuedAt.plusYears(3)))
      .map((a) => {
        const exposure = a.amount.percent(ctx.law.ipnBracket1Rate);
        return makeFinding(ctx, asOf, {
          ruleId: ID,
          severity: 'HIGH',
          norm: NORM,
          subjectId: a.id,
          exposure,
          message: `Подотчёт ${formatTenge(a.amount)} (ИИН ${a.employeeIin.value}) не закрыт с ${a.issuedAt.toISO()} — более 3 лет. Признаётся доходом физлица: доначисление ИПН ${formatTenge(exposure)}.`,
          sourceDocuments: [{ system: '1С', documentType: 'авансовый отчёт', documentId: a.id }],
          remediation: {
            kind: 'CLEAR_ADVANCE',
            description: 'Закрыть подотчёт документами или удержать из дохода',
            autonomyLevel: 'A2',
          },
        });
      }),
});
