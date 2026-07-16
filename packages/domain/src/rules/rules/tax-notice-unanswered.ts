import { addWorkingDays, daysBetween } from '../../kernel/local-date';
import { Money } from '../../kernel/money';
import { defineRule } from '../types';
import { makeFinding } from '../helpers';

const ID = 'TAX_NOTICE_UNANSWERED';
const NORM = 'НК РК — исполнение уведомлений КГД (30 рабочих дней)';

/** За сколько календарных дней до дедлайна поднимаем тревогу. */
export const NOTICE_WARNING_DAYS = 14;

/**
 * Уведомление КГД не исполнено, срок (30 рабочих дней) приближается или
 * прошёл → блокировка банковских счетов. Экспозиция денежно не выражается
 * (риск остановки всех операций) — ноль с CRITICAL severity.
 */
export const taxNoticeUnanswered = defineRule({
  id: ID,
  severity: 'CRITICAL',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.taxNotices
      .filter((n) => n.respondedAt === null)
      .flatMap((n) => {
        const deadline = addWorkingDays(n.receivedAt, ctx.law.noticeResponseWorkingDays, ctx.law.holidays);
        const daysLeft = daysBetween(asOf, deadline);
        if (daysLeft > NOTICE_WARNING_DAYS) return [];
        const overdue = daysLeft < 0;
        return [
          makeFinding(ctx, asOf, {
            ruleId: ID,
            severity: 'CRITICAL',
            norm: NORM,
            subjectId: n.id,
            exposure: Money.zero(),
            message: overdue
              ? `Уведомление КГД «${n.description}» не исполнено к сроку ${deadline.toISO()}: счета могут быть заблокированы в любой момент.`
              : `Уведомление КГД «${n.description}»: до блокировки счетов осталось ${daysLeft} дн. (срок ${deadline.toISO()}).`,
            sourceDocuments: [{ system: 'КНП', documentType: 'уведомление КГД', documentId: n.id }],
            remediation: {
              kind: 'RESPOND_TO_TAX_NOTICE',
              description: 'Подготовить ответ/пояснение на уведомление (требуется ЭЦП)',
              autonomyLevel: 'A1',
            },
          }),
        ];
      }),
});
