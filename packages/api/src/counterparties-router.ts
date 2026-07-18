import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { CounterpartyVerdict } from '@sana/domain';
import { checkCounterparty, listCompanyCounterparties } from '@sana/app';
import { accountingWorkspace } from './accounting-router';
import type { ApiContext } from './context';

/**
 * Контрагенты (§7): (а) список по проводкам компании со статусом риска,
 * (б) точечная проверка по БИН с явным вердиктом. Чтение реестра КГД
 * (фикстура), без записи.
 */

const t = initTRPC.context<ApiContext>().create();

type HistoryItem = {
  readonly bin: string;
  readonly name: string;
  readonly risky: boolean;
  readonly checkedAtIso: string;
};

/** История проверок на контекст (единственная компания MVP). */
const historyByContext = new WeakMap<object, HistoryItem[]>();

function history(ctx: ApiContext): HistoryItem[] {
  let list = historyByContext.get(ctx);
  if (list === undefined) {
    list = [];
    historyByContext.set(ctx, list);
  }
  return list;
}

function verdictDto(v: CounterpartyVerdict) {
  return {
    бин: v.bin,
    наименование: v.name,
    вердикт: v.risky ? ('Есть риск' as const) : ('Без риска' as const),
    критично: v.critical,
    причины: v.reasons,
    норма: v.norm,
    скорингРиска: v.riskScore,
    провереноВРеестре: v.lastCheckedAt,
  };
}

export const counterpartiesRouter = t.router({
  /** (а) Контрагенты компании: сделки, суммы, статус риска. Рисковые — первыми. */
  list: t.procedure.query(async ({ ctx }) => {
    const entries = accountingWorkspace(ctx).ledger.entries();
    const list = await listCompanyCounterparties(entries, ctx.ports.registry);
    return list.map((c) => ({
      бин: c.bin,
      наименование: c.name,
      сделок: c.deals,
      оборот: { tiyn: c.totalAmount.amount.toString(), tenge: c.totalAmount.toDecimalString() },
      статус:
        c.verdict === null
          ? ('Нет в реестре проверки' as const)
          : c.verdict.risky
            ? ('В перечне риска КГД' as const)
            : ('Без признаков риска' as const),
      вердикт: c.verdict === null ? null : verdictDto(c.verdict),
    }));
  }),

  /** (б) Проверка по БИН: карточка «есть риск / нет риска» + причина + норма. */
  check: t.procedure.input(z.object({ bin: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const result = await checkCounterparty(ctx.ports.registry, input.bin);
    if (!result.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
    if (result.value.kind === 'NOT_FOUND') {
      return {
        найден: false as const,
        сообщение: `Контрагент с БИН ${result.value.bin} не найден в реестре проверки.`,
      };
    }
    const v = result.value.verdict;
    history(ctx).unshift({
      bin: v.bin,
      name: v.name,
      risky: v.risky,
      checkedAtIso: ctx.today.toISO(),
    });
    return { найден: true as const, карточка: verdictDto(v) };
  }),

  /** История проверок этого сеанса. */
  checkHistory: t.procedure.query(({ ctx }) =>
    history(ctx).map((h) => ({
      бин: h.bin,
      наименование: h.name,
      вердикт: h.risky ? ('Есть риск' as const) : ('Без риска' as const),
      проверено: h.checkedAtIso,
    })),
  ),
});
