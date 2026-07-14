import { defineRule } from '../types';
import { formatTenge, invoiceDocRef, makeFinding } from '../helpers';

const ID = 'ESF_CONFIRMATION_PENDING';
const NORM = 'ст. 499–501 НК РК';

/**
 * Входящий (исправленный/дополнительный) ЭСФ ожидает нашего подтверждения.
 * Неподтверждение ставит под риск зачёт НДС по документу.
 */
export const esfConfirmationPending = defineRule({
  id: ID,
  severity: 'MEDIUM',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.invoices
      .filter((inv) => inv.direction === 'IN' && inv.status === 'ВЫСТАВЛЕН')
      .map((inv) =>
        makeFinding(ctx, asOf, {
          ruleId: ID,
          severity: 'MEDIUM',
          norm: NORM,
          subjectId: inv.id,
          exposure: inv.vatAmount,
          message: `Входящий ЭСФ № ${inv.number} от ${inv.counterpartyName} ожидает подтверждения. Под риском зачёт НДС ${formatTenge(inv.vatAmount)}.`,
          sourceDocuments: [invoiceDocRef(inv.number)],
          remediation: {
            kind: 'CONFIRM_ESF',
            description: 'Подтвердить (или отклонить) ЭСФ в ИС ЭСФ',
            autonomyLevel: 'A2',
          },
        }),
      ),
});
