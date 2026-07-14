import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

const ID = 'ESF_NONRESIDENT_OVERDUE';
const NORM = 'п. 9 ст. 493 НК РК';

/**
 * НДС за нерезидента уплачен, ЭСФ не выписан в течение 5 календарных дней.
 */
export const esfNonresidentOverdue = defineRule({
  id: ID,
  severity: 'HIGH',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.nonResidentVatPayments
      .filter(
        (p) =>
          p.esfIssuedAt === null &&
          asOf.isAfter(p.paidAt.plusDays(ctx.law.esfNonresidentDeadlineCalendarDays)),
      )
      .map((p) => {
        const fine = ctx.law.mrp.multiply(ctx.law.fineEsfNonIssueMrp);
        return makeFinding(ctx, asOf, {
          ruleId: ID,
          severity: 'HIGH',
          norm: NORM,
          subjectId: p.id,
          exposure: fine,
          message: `НДС за нерезидента (${formatTenge(p.vatAmount)}) уплачен ${p.paidAt.toISO()}, но ЭСФ не выписан в 5-дневный срок. Риск штрафа ${formatTenge(fine)}.`,
          sourceDocuments: [{ system: 'КНП', documentType: 'платёж НДС за нерезидента', documentId: p.id }],
          remediation: {
            kind: 'ISSUE_ESF_NONRESIDENT',
            description: 'Выписать ЭСФ по НДС за нерезидента',
            autonomyLevel: 'A2',
          },
        });
      }),
});
