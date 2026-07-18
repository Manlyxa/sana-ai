import { initTRPC, TRPCError } from '@trpc/server';
import {
  addWorkingDays,
  daysBetween,
  periodOffsetDate,
  TaxPeriod,
  type LocalDate,
} from '@sana/domain';
import { createSeededStore, P, type ParamKey } from '@sana/legal-params';
import type { ApiContext } from './context';

/**
 * Календарь сроков (§9) — не отдельный модуль, а вывод дедлайнов,
 * которые уже знает система: сроки ФНО и зарплатных платежей из
 * legal-params, обязательства из кабинета налогоплательщика,
 * дедлайны ответов на уведомления КГД (30 рабочих дней).
 */

const t = initTRPC.context<ApiContext>().create();

export type Deadline = {
  readonly дата: string;
  readonly название: string;
  readonly подпись: string;
  readonly осталосьДней: number;
  readonly скоро: boolean;
  readonly источник: 'legal-params' | 'кабинет НП' | 'уведомление КГД';
};

const SOON_WINDOW_DAYS = 30;

function deadline(
  today: LocalDate,
  date: LocalDate,
  название: string,
  подпись: string,
  источник: Deadline['источник'],
): Deadline {
  const left = daysBetween(today, date);
  return {
    дата: date.toISO(),
    название,
    подпись,
    осталосьДней: left,
    скоро: left >= 0 && left <= SOON_WINDOW_DAYS,
    источник,
  };
}

/** Все известные системе дедлайны — переиспользуется обзором (§1). */
export async function computeDeadlines(ctx: ApiContext): Promise<{ сегодня: string; сроки: Deadline[] }> {
  const store = createSeededStore();
    const resolve = <T>(key: ParamKey<T>): T => {
      const r = store.resolve(key, ctx.today);
      if (!r.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметр не определён' });
      return r.value.value;
    };

    const items: Deadline[] = [];

    // Сроки ФНО и зарплатных платежей — из legal-params для текущих периодов.
    const half = TaxPeriod.containing('HALF_YEAR', ctx.today);
    items.push(
      deadline(
        ctx.today,
        periodOffsetDate(half.end(), resolve(P.FNO_910_FILING_DUE)),
        'Форма 910.00 — упрощённая декларация',
        `за ${half.code()} · ст. 728 НК РК`,
        'legal-params',
      ),
    );
    const quarter = TaxPeriod.containing('QUARTER', ctx.today);
    items.push(
      deadline(
        ctx.today,
        periodOffsetDate(quarter.end(), resolve(P.FNO_200_FILING_DUE)),
        'Форма 200.00 — ИПН и соцплатежи',
        `за ${quarter.code()} · ст. 489 НК РК`,
        'legal-params',
      ),
    );
    const month = TaxPeriod.containing('MONTH', ctx.today);
    items.push(
      deadline(
        ctx.today,
        periodOffsetDate(month.end(), resolve(P.PAYROLL_TAXES_PAYMENT_DUE)),
        'Уплата зарплатных налогов и взносов',
        `за ${month.code()} · ст. 321, 487 НК РК`,
        'legal-params',
      ),
    );

    // Обязательства из кабинета налогоплательщика (фикстура) — как есть.
    const obligations = await ctx.ports.taxCabinet.listObligations(ctx.company.bin);
    if (obligations.ok) {
      for (const o of obligations.value) {
        if (o.status === 'SUBMITTED' || o.status === 'PAID') continue;
        items.push(
          deadline(ctx.today, o.dueDate, `${o.kind} за ${o.period.code()}`, `статус: ${o.status}`, 'кабинет НП'),
        );
      }
    }

    // Уведомления КГД: ответ в течение 30 рабочих дней с учётом праздников.
    const notices = await ctx.ports.taxCabinet.listNotices(ctx.company.bin);
    if (notices.ok) {
      const workingDays = resolve(P.KGD_NOTICE_RESPONSE_DAYS).days;
      const holidays = new Set(resolve(P.CALENDAR_HOLIDAYS));
      for (const n of notices.value) {
        if (n.respondedAt !== null) continue;
        items.push(
          deadline(
            ctx.today,
            addWorkingDays(n.receivedAt, workingDays, holidays),
            `Ответ на уведомление КГД ${n.id}`,
            `получено ${n.receivedAt.toISO()} · ${workingDays} рабочих дней`,
            'уведомление КГД',
          ),
        );
      }
    }

  items.sort((a, b) => a.дата.localeCompare(b.дата));
  return { сегодня: ctx.today.toISO(), сроки: items };
}

export const calendarRouter = t.router({
  deadlines: t.procedure.query(({ ctx }) => computeDeadlines(ctx)),
});
