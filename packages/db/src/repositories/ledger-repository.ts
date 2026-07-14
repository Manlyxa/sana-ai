import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  all as allResults,
  err,
  ok,
  TaxPeriod,
  type JournalEntry,
  type Result,
  type TaxRegisterEntry,
  type TaxRegisterKind,
} from '@sana/domain';
import { LocalDate } from '@sana/domain';
import type { Db } from '../client';
import { journalEntries, taxRegisterEntries } from '../schema';
import { moneyFromRow, moneySchema, moneyToRow, toJsonb } from '../codec';

/**
 * Персистентные проекции двойного регистра (P7). Проекции детерминированы
 * и пересобираемы из событий, поэтому запись — полная замена по компании.
 */

const journalLineSchema = z.object({
  account: z.string(),
  side: z.enum(['DEBIT', 'CREDIT']),
  amount: moneySchema,
});

export class LedgerRepository {
  constructor(private readonly db: Db) {}

  async replaceJournal(companyId: string, entries: readonly JournalEntry[]): Promise<void> {
    await this.db.delete(journalEntries).where(eq(journalEntries.companyId, companyId));
    for (const entry of entries) {
      await this.db.insert(journalEntries).values({
        id: entry.id,
        companyId: entry.companyId,
        businessEventId: entry.businessEventId,
        date: entry.date.toISO(),
        memo: entry.memo,
        lines: toJsonb(entry.lines),
      });
    }
  }

  async listJournal(companyId: string): Promise<Result<readonly JournalEntry[], string>> {
    const rows = await this.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, companyId))
      .orderBy(asc(journalEntries.date), asc(journalEntries.id));
    return allResults(
      rows.map((row): Result<JournalEntry, string> => {
        const date = LocalDate.parse(row.date);
        const lines = z.array(journalLineSchema).safeParse(row.lines);
        if (!date.ok || !lines.success) return err(`проводка ${row.id}: повреждена`);
        return ok({
          id: row.id,
          companyId: row.companyId,
          businessEventId: row.businessEventId,
          date: date.value,
          lines: lines.data,
          memo: row.memo,
        });
      }),
    );
  }

  async replaceTaxRegisters(companyId: string, entries: readonly TaxRegisterEntry[]): Promise<void> {
    await this.db.delete(taxRegisterEntries).where(eq(taxRegisterEntries.companyId, companyId));
    for (const entry of entries) {
      const money = moneyToRow(entry.amount);
      await this.db.insert(taxRegisterEntries).values({
        id: entry.id,
        companyId: entry.companyId,
        businessEventId: entry.businessEventId,
        register: entry.register,
        period: entry.period.code(),
        amountTiyn: money.amountTiyn,
        currency: money.currency,
        norm: entry.norm,
      });
    }
  }

  async listTaxRegisters(companyId: string): Promise<Result<readonly TaxRegisterEntry[], string>> {
    const rows = await this.db
      .select()
      .from(taxRegisterEntries)
      .where(eq(taxRegisterEntries.companyId, companyId))
      .orderBy(asc(taxRegisterEntries.id));
    return allResults(
      rows.map((row): Result<TaxRegisterEntry, string> => {
        const period = TaxPeriod.parse(row.period);
        if (!period.ok) return err(`запись регистра ${row.id}: период`);
        return ok({
          id: row.id,
          companyId: row.companyId,
          businessEventId: row.businessEventId,
          register: row.register as TaxRegisterKind,
          period: period.value,
          amount: moneyFromRow(row.amountTiyn, row.currency),
          norm: row.norm,
        });
      }),
    );
  }
}
