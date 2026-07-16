import { daysBetween } from '../../kernel/local-date';
import { isPastDue, type TaxObligation } from '../../entities/tax-obligation';
import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

/** Сроки сдачи ФНО и уплаты налогов. */

const FILING_KINDS: readonly TaxObligation['kind'][] = ['ФНО_100', 'ФНО_200', 'ФНО_300', 'ФНО_910'];
const PAYMENT_KINDS: readonly TaxObligation['kind'][] = ['НДС_ПЛАТЁЖ', 'КПН_ПЛАТЁЖ', 'ЗАРПЛАТНЫЕ_ПЛАТЕЖИ'];

/** За сколько календарных дней до срока начинаем поднимать тревогу. */
export const APPROACHING_WINDOW_DAYS = 10;

function obligationDocRef(o: TaxObligation) {
  return { system: 'SANA', documentType: 'налоговое обязательство', documentId: o.id };
}

const APPROACHING_ID = 'FILING_DEADLINE_APPROACHING';

export const filingDeadlineApproaching = defineRule({
  id: APPROACHING_ID,
  severity: 'MEDIUM',
  norm: 'НК РК — сроки представления ФНО',
  evaluate: (ctx, asOf) =>
    ctx.obligations
      .filter((o) => {
        if (!FILING_KINDS.includes(o.kind)) return false;
        if (o.status !== 'PENDING' && o.status !== 'PREPARED') return false;
        const left = daysBetween(asOf, o.dueDate);
        return left >= 0 && left <= APPROACHING_WINDOW_DAYS;
      })
      .map((o) => {
        const fine = ctx.law.mrp.multiply(ctx.law.fineFnoLateMrp);
        const exposure = o.amount ?? fine;
        return makeFinding(ctx, asOf, {
          ruleId: APPROACHING_ID,
          severity: 'MEDIUM',
          norm: 'НК РК — сроки представления ФНО',
          subjectId: o.id,
          exposure,
          message: `${o.kind} за ${o.period.code()}: срок ${o.dueDate.toISO()} (осталось ${daysBetween(asOf, o.dueDate)} дн.), форма ещё не подписана. Под риском ${formatTenge(exposure)}.`,
          sourceDocuments: [obligationDocRef(o)],
          remediation: {
            kind: 'PREPARE_AND_SIGN_FNO',
            description: 'Подготовить форму и запросить ЭЦП владельца',
            autonomyLevel: 'A1',
          },
        });
      }),
});

const OVERDUE_ID = 'FILING_OVERDUE';

export const filingOverdue = defineRule({
  id: OVERDUE_ID,
  severity: 'CRITICAL',
  norm: 'ст. 272 КоАП РК (непредставление ФНО)',
  evaluate: (ctx, asOf) =>
    ctx.obligations
      .filter((o) => FILING_KINDS.includes(o.kind) && isPastDue(o, asOf))
      .map((o) => {
        const fine = ctx.law.mrp.multiply(ctx.law.fineFnoLateMrp);
        return makeFinding(ctx, asOf, {
          ruleId: OVERDUE_ID,
          severity: 'CRITICAL',
          norm: 'ст. 272 КоАП РК (непредставление ФНО)',
          subjectId: o.id,
          exposure: fine,
          message: `${o.kind} за ${o.period.code()} просрочена: срок был ${o.dueDate.toISO()}. Штраф до ${formatTenge(fine)} и риск блокировки счетов.`,
          sourceDocuments: [obligationDocRef(o)],
          remediation: {
            kind: 'FILE_OVERDUE_FNO',
            description: 'Немедленно подготовить и подать форму (требуется ЭЦП)',
            autonomyLevel: 'A1',
          },
        });
      }),
});

const PAYMENT_ID = 'PAYMENT_OVERDUE';

export const paymentOverdue = defineRule({
  id: PAYMENT_ID,
  severity: 'CRITICAL',
  norm: 'НК РК — сроки уплаты; пеня за каждый день просрочки',
  evaluate: (ctx, asOf) =>
    ctx.obligations
      .filter((o) => PAYMENT_KINDS.includes(o.kind) && isPastDue(o, asOf))
      .map((o) => {
        const exposure = o.amount ?? ctx.law.mrp.multiply(ctx.law.fineFnoLateMrp);
        return makeFinding(ctx, asOf, {
          ruleId: PAYMENT_ID,
          severity: 'CRITICAL',
          norm: 'НК РК — сроки уплаты; пеня за каждый день просрочки',
          subjectId: o.id,
          exposure,
          message: `${o.kind} за ${o.period.code()} не уплачен: срок был ${o.dueDate.toISO()}. Под риском ${formatTenge(exposure)} плюс пеня за каждый день.`,
          sourceDocuments: [obligationDocRef(o)],
          remediation: {
            kind: 'PAY_TAX',
            description: 'Сформировать платёжное поручение (требуется ЭЦП)',
            autonomyLevel: 'A1',
          },
        });
      }),
});
