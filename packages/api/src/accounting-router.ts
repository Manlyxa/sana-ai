import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  balanceSheet,
  cashFlowStatement,
  LocalDate,
  profitLossStatement,
  TaxPeriod,
  trialBalance,
  type Money,
  type ReportSection,
} from '@sana/domain';
import { AccountingWorkspace, eventsFromBankLines, eventsFromInvoices, importJournalCsv } from '@sana/app';
import type { ApiContext } from './context';

/**
 * Accounting API (Modules 1–5) — a minimal additive router mounted next
 * to the existing procedures; nothing in the pre-existing API changes.
 * Ответы, адресованные пользователю, — на русском.
 */

const t = initTRPC.context<ApiContext>().create();

/** In-memory workspace per API context (single-company MVP). */
const workspaces = new WeakMap<object, AccountingWorkspace>();

function workspace(ctx: ApiContext): AccountingWorkspace {
  let ws = workspaces.get(ctx);
  if (ws === undefined) {
    ws = new AccountingWorkspace(ctx.company.id);
    workspaces.set(ctx, ws);
  }
  return ws;
}

function money(m: Money): { tiyn: string; tenge: string } {
  return { tiyn: m.amount.toString(), tenge: m.toDecimalString() };
}

function sectionDto(s: ReportSection) {
  return {
    title: s.title,
    total: money(s.total),
    lines: s.lines.map((l) => ({
      id: l.id,
      account: l.account,
      label: l.label,
      amount: money(l.amount),
      entryIds: l.entryIds,
    })),
  };
}

function parsePeriod(code: string): TaxPeriod {
  const parsed = TaxPeriod.parse(code);
  if (!parsed.ok) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `неверный код периода: ${parsed.error}` });
  }
  return parsed.value;
}

function parseDate(iso: string): LocalDate {
  const parsed = LocalDate.parse(iso);
  if (!parsed.ok) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.error });
  }
  return parsed.value;
}

export const accountingRouter = t.router({
  /** Прогнать события из фикстур (ЭСФ + банк) через движок автопроводок. */
  ingestFixtures: t.procedure.mutation(async ({ ctx }) => {
    const ws = workspace(ctx);
    const [invoices, bankLines] = await Promise.all([
      ctx.ports.esf.listInvoices(ctx.company.bin, { from: LocalDate.of(2026, 1, 1), to: ctx.today }),
      ctx.ports.bank.getStatement(ctx.accountIban, { from: LocalDate.of(2026, 1, 1), to: ctx.today }),
    ]);
    if (!invoices.ok || !bankLines.ok) {
      throw new TRPCError({ code: 'BAD_GATEWAY', message: 'источники данных недоступны' });
    }
    const events = [
      ...eventsFromInvoices(ctx.company.id, invoices.value, ctx.today),
      ...eventsFromBankLines(ctx.company.id, bankLines.value, ctx.today),
    ];
    let posted = 0;
    let queued = 0;
    let skipped = 0;
    for (const event of events) {
      const outcome = await ws.processEvent(event);
      if (!outcome.ok) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: outcome.error.message });
      }
      if (outcome.value.kind === 'POSTED') posted += 1;
      else if (outcome.value.kind === 'QUEUED') queued += 1;
      else skipped += 1;
    }
    return {
      сообщение: `Обработано событий: ${events.length}; проведено автоматически: ${posted}; в очереди подтверждения: ${queued}.`,
      events: events.length,
      posted,
      queued,
      skipped,
    };
  }),

  /** Очередь подтверждения (Module 3). */
  queue: t.procedure.query(({ ctx }) =>
    workspace(ctx)
      .pendingOperations()
      .map((p) => ({
        id: p.id,
        событие: {
          id: p.event.id,
          тип: p.event.type,
          дата: p.event.occurredAt.toISO(),
          источник: p.event.sourceSystem,
        },
        проводка: p.proposal.lines.map((l) => ({
          счёт: l.account,
          сторона: l.side === 'DEBIT' ? 'Дт' : 'Кт',
          сумма: money(l.amount),
        })),
        объяснение: p.proposal.explanation,
        confidence: p.proposal.confidence,
      })),
  ),

  /** Подтвердить как есть или с другим счётом. */
  confirm: t.procedure
    .input(
      z.object({
        pendingId: z.string(),
        confirmedBy: z.string().min(1),
        account: z.object({ from: z.string(), to: z.string(), category: z.string().nullish() }).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const ws = workspace(ctx);
      const args = { confirmedBy: input.confirmedBy, at: ctx.today };
      const result = input.account
        ? ws.confirmWithAccount(input.pendingId, {
            ...args,
            fromAccount: input.account.from,
            toAccount: input.account.to,
            category: input.account.category ?? null,
          })
        : ws.confirm(input.pendingId, args);
      if (!result.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
      return {
        сообщение: `Проводка ${result.value.entry.id} создана.`,
        entryId: result.value.entry.id,
        ruleId: result.value.rule?.id ?? null,
      };
    }),

  /** Отклонить с причиной. */
  reject: t.procedure
    .input(z.object({ pendingId: z.string(), rejectedBy: z.string().min(1), reason: z.string() }))
    .mutation(({ ctx, input }) => {
      const result = workspace(ctx).reject(input.pendingId, {
        rejectedBy: input.rejectedBy,
        at: ctx.today,
        reason: input.reason,
      });
      if (!result.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
      return { сообщение: 'Операция отклонена, проводка не создана.' };
    }),

  /** Закрыть месячный период (Module 1). */
  closePeriod: t.procedure
    .input(z.object({ period: z.string() }))
    .mutation(({ ctx, input }) => {
      const result = workspace(ctx).ledger.closePeriod(parsePeriod(input.period));
      if (!result.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
      return { сообщение: `Период ${result.value.code()} закрыт.` };
    }),

  /** ОСВ за период, с фильтром субледжера (Module 1). */
  trialBalance: t.procedure
    .input(z.object({ period: z.string(), counterpartyBin: z.string().nullish(), category: z.string().nullish() }))
    .query(({ ctx, input }) => {
      const filter = {
        ...(input.counterpartyBin ? { counterpartyBin: input.counterpartyBin } : {}),
        ...(input.category ? { category: input.category } : {}),
      };
      const tb = trialBalance(
        workspace(ctx).ledger.entries(),
        parsePeriod(input.period),
        Object.keys(filter).length > 0 ? { filter } : {},
      );
      return {
        период: tb.period.code(),
        сбалансирована: tb.balanced,
        строки: tb.rows.map((r) => ({
          счёт: r.account,
          наименование: r.accountName,
          сальдоНачальноеДт: money(r.openingDebit),
          сальдоНачальноеКт: money(r.openingCredit),
          оборотДт: money(r.turnoverDebit),
          оборотКт: money(r.turnoverCredit),
          сальдоКонечноеДт: money(r.closingDebit),
          сальдоКонечноеКт: money(r.closingCredit),
          entryIds: r.entryIds,
        })),
        итого: {
          оборотДт: money(tb.totals.turnoverDebit),
          оборотКт: money(tb.totals.turnoverCredit),
        },
      };
    }),

  /** Баланс на дату (Module 4). */
  balanceSheet: t.procedure.input(z.object({ asOf: z.string() })).query(({ ctx, input }) => {
    const bs = balanceSheet(workspace(ctx).ledger.entries(), parseDate(input.asOf));
    return {
      наДату: bs.asOf.toISO(),
      активы: sectionDto(bs.assets),
      обязательства: sectionDto(bs.liabilities),
      капитал: sectionDto(bs.equity),
      балансСходится: bs.balanced,
    };
  }),

  /** ОПиУ за период (Module 4). */
  profitLoss: t.procedure.input(z.object({ period: z.string() })).query(({ ctx, input }) => {
    const pl = profitLossStatement(workspace(ctx).ledger.entries(), parsePeriod(input.period));
    return {
      период: pl.period.code(),
      доходы: sectionDto(pl.revenue),
      расходы: sectionDto(pl.expenses),
      прибыль: money(pl.profit),
    };
  }),

  /** ОДДС (прямой метод) за период (Module 4). */
  cashFlow: t.procedure.input(z.object({ period: z.string() })).query(({ ctx, input }) => {
    const cf = cashFlowStatement(workspace(ctx).ledger.entries(), parsePeriod(input.period));
    const section = (s: typeof cf.operating) => ({
      раздел: s.title,
      итого: money(s.net),
      движения: s.items.map((i) => ({
        id: i.id,
        контрСчёт: i.counterAccount,
        описание: i.memo,
        сумма: money(i.amount),
        entryId: i.entryId,
      })),
    });
    return {
      период: cf.period.code(),
      операционная: section(cf.operating),
      инвестиционная: section(cf.investing),
      финансовая: section(cf.financing),
      денежныеСредстваНаНачало: money(cf.openingCash),
      денежныеСредстваНаКонец: money(cf.closingCash),
      чистоеИзменение: money(cf.netChange),
      сходится: cf.consistent,
    };
  }),

  /** Импорт журнала из CSV (выгрузка Excel) — Module 4. */
  importJournal: t.procedure
    .input(z.object({ csv: z.string(), fileName: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const ws = workspace(ctx);
      const imported = importJournalCsv(input.csv, { companyId: ctx.company.id, fileName: input.fileName });
      if (!imported.ok) {
        return {
          успех: false as const,
          сообщение: 'Файл отклонён: импортированная книга не прошла проверку.',
          ошибки: imported.error.map((d) => ({ строка: d.row, сообщение: d.message })),
        };
      }
      for (const entry of imported.value.entries) {
        const posted = ws.ledger.post(entry);
        if (!posted.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: posted.error.message });
        }
      }
      return {
        успех: true as const,
        сообщение: `Импортировано проводок: ${imported.value.entries.length}.`,
        entryIds: imported.value.entries.map((e) => e.id),
      };
    }),

  /** «Объясни эту цифру» (Module 5). */
  explain: t.procedure
    .input(
      z.union([
        z.object({ ledgerEntryId: z.string() }),
        z.object({ reportLineId: z.string(), period: z.string() }),
      ]),
    )
    .query(({ ctx, input }) => {
      const ws = workspace(ctx);
      const result =
        'ledgerEntryId' in input
          ? ws.explain({ kind: 'LEDGER_ENTRY', ledgerEntryId: input.ledgerEntryId })
          : ws.explain({ kind: 'REPORT_LINE', reportLineId: input.reportLineId, period: parsePeriod(input.period) });
      if (!result.ok) throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message });
      const e = result.value;
      return {
        объект: e.subject,
        факт: e.fact,
        правило: e.rule,
        результат: e.result,
        ссылки: e.references,
      };
    }),
});
