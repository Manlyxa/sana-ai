import { daysBetween } from '../../kernel/local-date';
import { defineRule } from '../types';
import { formatTenge, invoiceDocRef, makeFinding } from '../helpers';

const ID = 'ESF_ISSUE_OVERDUE';
const NORM = 'ст. 493 НК РК';

/**
 * Оборот совершён более 15 календарных дней назад, ЭСФ не выставлен
 * (черновик). Экспозиция — штраф КоАП за невыписку (МРП, TODO_VERIFY).
 */
export const esfIssueOverdue = defineRule({
  id: ID,
  severity: 'HIGH',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.invoices
      .filter(
        (inv) =>
          inv.direction === 'OUT' &&
          inv.status === 'ЧЕРНОВИК' &&
          daysBetween(inv.turnoverDate, asOf) > ctx.law.esfIssueDeadlineCalendarDays,
      )
      .map((inv) => {
        const fine = ctx.law.mrp.multiply(ctx.law.fineEsfNonIssueMrp);
        const deadline = inv.turnoverDate.plusDays(ctx.law.esfIssueDeadlineCalendarDays);
        return makeFinding(ctx, asOf, {
          ruleId: ID,
          severity: 'HIGH',
          norm: NORM,
          subjectId: inv.id,
          exposure: fine,
          message: `ЭСФ № ${inv.number} не выставлен: срок истёк ${deadline.toISO()} (15 календарных дней с даты оборота ${inv.turnoverDate.toISO()}). Риск штрафа ${formatTenge(fine)}.`,
          sourceDocuments: [invoiceDocRef(inv.number)],
          remediation: {
            kind: 'ISSUE_ESF',
            description: 'Выставить ЭСФ в ИС ЭСФ',
            autonomyLevel: 'A2',
          },
        });
      }),
});
