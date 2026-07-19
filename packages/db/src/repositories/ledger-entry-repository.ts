import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  all as allResults,
  createLedgerEntry,
  err,
  LocalDate,
  Money,
  ok,
  type CurrencyCode,
  type LedgerEntry,
  type Result,
} from '@sana/domain';
import type { Db } from '../client';
import { ledgerEntries } from '../schema';

/**
 * Персистентность главной книги (двойная запись). Append-only: append
 * идемпотентен (onConflictDoNothing по id), поэтому дозапись всех проводок
 * реестра после операции безопасна — уже сохранённые не дублируются.
 * Гидратация восстанавливает проводки в порядке seq для повторного
 * проигрывания в GeneralLedger.
 */

const currencySchema = z.enum(['KZT', 'USD', 'EUR', 'RUB', 'CNY']);

const lineSchema = z.object({
  account: z.string(),
  side: z.enum(['DEBIT', 'CREDIT']),
  amountTiyn: z.string().regex(/^-?\d+$/),
  currency: currencySchema,
});

type LineRow = { account: string; side: 'DEBIT' | 'CREDIT'; amountTiyn: string; currency: CurrencyCode };

function linesToRow(entry: LedgerEntry): LineRow[] {
  return entry.lines.map((l) => ({
    account: l.account,
    side: l.side,
    amountTiyn: l.amount.amount.toString(),
    currency: l.amount.currency,
  }));
}

export class LedgerEntryRepository {
  constructor(private readonly db: Db) {}

  /** Дозаписать проводки, которых ещё нет (append-only, идемпотентно по id). */
  async append(entries: readonly LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.db
        .insert(ledgerEntries)
        .values({
          id: entry.id,
          companyId: entry.companyId,
          sourceEventId: entry.sourceEventId,
          date: entry.date.toISO(),
          memo: entry.memo,
          lines: linesToRow(entry),
          counterpartyBin: entry.analytics.counterpartyBin,
          counterpartyName: entry.analytics.counterpartyName,
          category: entry.analytics.category,
          norm: entry.norm,
          legalParamsVersion: entry.legalParamsVersion,
          reversesEntryId: entry.reversesEntryId,
        })
        .onConflictDoNothing({ target: ledgerEntries.id });
    }
  }

  /** Все проводки компании в порядке добавления (seq) — для гидратации. */
  async list(companyId: string): Promise<Result<readonly LedgerEntry[], string>> {
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.companyId, companyId))
      .orderBy(asc(ledgerEntries.seq));
    return allResults(
      rows.map((row): Result<LedgerEntry, string> => {
        const date = LocalDate.parse(row.date);
        const lines = z.array(lineSchema).safeParse(row.lines);
        if (!date.ok || !lines.success) return err(`проводка ${row.id}: повреждена`);
        // Проводим через доменную фабрику: период выводится, инварианты
        // двойной записи проверяются заново (мусор из БД — ошибка, не тихо).
        const created = createLedgerEntry({
          id: row.id,
          companyId: row.companyId,
          sourceEventId: row.sourceEventId,
          date: date.value,
          lines: lines.data.map((l) => ({
            account: l.account,
            side: l.side,
            amount: Money.ofMinor(BigInt(l.amountTiyn), l.currency),
          })),
          memo: row.memo,
          analytics: {
            counterpartyBin: row.counterpartyBin,
            counterpartyName: row.counterpartyName,
            category: row.category,
          },
          norm: row.norm,
          legalParamsVersion: row.legalParamsVersion,
          reversesEntryId: row.reversesEntryId,
        });
        return created.ok ? ok(created.value) : err(`проводка ${row.id}: ${created.error.message}`);
      }),
    );
  }
}
