import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { BANK_CATALOG, BankDirectory, emptyBankPort } from '@sana/app';
import type { ApiContext } from './context';

/**
 * Банковские счета (§13): каркас подключения источников. Подключённые
 * источники питают автопроводки (§2); реальные API банков — следующая
 * волна, меняющая только порт.
 */

const t = initTRPC.context<ApiContext>().create();

const directories = new WeakMap<object, BankDirectory>();

/** Справочник банков контекста; Kaspi предподключён с фикстурной выпиской. */
export function bankDirectory(ctx: ApiContext): BankDirectory {
  let dir = directories.get(ctx);
  if (dir === undefined) {
    dir = new BankDirectory(BANK_CATALOG, {
      id: 'kaspi',
      iban: ctx.accountIban,
      port: ctx.ports.bank,
      at: ctx.today,
    });
    directories.set(ctx, dir);
  }
  return dir;
}

export const banksRouter = t.router({
  /** Все банки каталога: подключённые и доступные. */
  list: t.procedure.query(({ ctx }) =>
    bankDirectory(ctx)
      .list()
      .map((b) => ({
        id: b.id,
        банк: b.name,
        код: b.shortCode,
        статус: b.status === 'CONNECTED' ? ('Подключено' as const) : ('Доступен' as const),
        iban: b.iban,
        подключён: b.connectedAt?.toISO() ?? null,
      })),
  ),

  /** «Подключить банк» — создаёт запись источника данных (фикстура). */
  connect: t.procedure.input(z.object({ bankId: z.string().min(1) })).mutation(({ ctx, input }) => {
    const connected = bankDirectory(ctx).connect(input.bankId, {
      iban: `KZ00DEMO${input.bankId.toUpperCase().padEnd(10, '0')}`,
      port: emptyBankPort(),
      at: ctx.today,
    });
    if (!connected.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: connected.error.message });
    return {
      сообщение: `${connected.value.name} подключён. Выписки источника участвуют в автопроводках.`,
      банк: connected.value.name,
      iban: connected.value.iban,
    };
  }),
});
