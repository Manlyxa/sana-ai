import { TaxPeriod } from '../../kernel/tax-period';
import { defineRule } from '../types';
import { formatTenge, invoiceDocRef, makeFinding, periodOffsetDate } from '../helpers';

const ID = 'VAT_CREDIT_NOTICE_MISSING';
const NORM = 'п. 8 ст. 480 НК РК';

/**
 * Входящий ЭСФ с НДС, по которому не отправлено извещение о зачёте до
 * крайнего срока сдачи ф.300.00 за квартал оборота → зачёт НДС теряется.
 * Экспозиция = сумма НДС документа.
 */
export const vatCreditNoticeMissing = defineRule({
  id: ID,
  severity: 'CRITICAL',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.invoices
      .filter(
        (inv) =>
          inv.direction === 'IN' &&
          inv.status !== 'АННУЛИРОВАН' &&
          inv.status !== 'ОТОЗВАН' &&
          inv.status !== 'ЧЕРНОВИК' &&
          inv.vatAmount.isPositive() &&
          inv.vatCreditNoticeSentAt === null,
      )
      .map((inv) => {
        const quarter = TaxPeriod.containing('QUARTER', inv.turnoverDate);
        const deadline = periodOffsetDate(quarter.end(), ctx.law.fno300Closes);
        const lost = asOf.isAfter(deadline);
        return makeFinding(ctx, asOf, {
          ruleId: ID,
          severity: 'CRITICAL',
          norm: NORM,
          subjectId: inv.id,
          exposure: inv.vatAmount,
          message: lost
            ? `Зачёт НДС ${formatTenge(inv.vatAmount)} по ЭСФ № ${inv.number} потерян: извещение о зачёте не отправлено до ${deadline.toISO()}.`
            : `Вы теряете ${formatTenge(inv.vatAmount)} зачёта НДС, если не отправите извещение о зачёте по ЭСФ № ${inv.number} до ${deadline.toISO()}.`,
          sourceDocuments: [invoiceDocRef(inv.number)],
          remediation: {
            kind: 'SEND_VAT_CREDIT_NOTICE',
            description: 'Отправить извещение о зачёте НДС в ИС ЭСФ',
            autonomyLevel: 'A3',
          },
        });
      }),
});
