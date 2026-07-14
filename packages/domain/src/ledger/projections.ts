import { TaxPeriod } from '../kernel/tax-period';
import { all, err, ok, type Result } from '../kernel/result';
import { grossTotal } from '../entities/invoice';
import { ACCOUNTS } from './accounts';
import type { BusinessEvent } from './business-event';
import { createJournalEntry, type JournalEntry, type JournalEntryError, type JournalLine } from './journal-entry';
import type { TaxRegisterEntry } from './tax-register-entry';

/**
 * Проекции теневого регистра (P7, P8): чистые функции
 * BusinessEvent[] → JournalEntry[] и BusinessEvent[] → TaxRegisterEntry[].
 *
 * Идентификаторы детерминированы от id события, поэтому повторный прогон
 * даёт байт-в-байт тот же результат (идемпотентность пересборки регистров).
 * Бухгалтерская и налоговая проекции не знают друг о друге и выводятся
 * независимо.
 */

export type ProjectionError = {
  readonly eventId: string;
  readonly reason: JournalEntryError;
};

/** Проекция одного события в бухгалтерскую проводку; null — событие не порождает проводку. */
export function projectJournalEntry(
  event: BusinessEvent,
): Result<JournalEntry | null, ProjectionError> {
  const lines = journalLinesFor(event);
  if (lines === null) return ok(null);
  const entry = createJournalEntry({
    id: `je-${event.id}`,
    companyId: event.companyId,
    businessEventId: event.id,
    date: event.occurredAt,
    lines,
    memo: memoFor(event),
  });
  if (!entry.ok) return err({ eventId: event.id, reason: entry.error });
  return ok(entry.value);
}

function journalLinesFor(event: BusinessEvent): readonly JournalLine[] | null {
  switch (event.type) {
    case 'ESF_ISSUED': {
      const { invoice } = (event as BusinessEvent<'ESF_ISSUED'>).payload;
      const lines: JournalLine[] = [
        { account: ACCOUNTS.TRADE_RECEIVABLES, side: 'DEBIT', amount: grossTotal(invoice) },
        { account: ACCOUNTS.REVENUE, side: 'CREDIT', amount: invoice.totalExVat },
      ];
      if (invoice.vatAmount.isPositive()) {
        lines.push({ account: ACCOUNTS.VAT_PAYABLE, side: 'CREDIT', amount: invoice.vatAmount });
      }
      return lines;
    }
    case 'ESF_RECEIVED': {
      const { invoice } = (event as BusinessEvent<'ESF_RECEIVED'>).payload;
      const lines: JournalLine[] = [
        { account: ACCOUNTS.INVENTORY_GOODS, side: 'DEBIT', amount: invoice.totalExVat },
      ];
      if (invoice.vatAmount.isPositive()) {
        lines.push({ account: ACCOUNTS.VAT_RECEIVABLE, side: 'DEBIT', amount: invoice.vatAmount });
      }
      lines.push({ account: ACCOUNTS.TRADE_PAYABLES, side: 'CREDIT', amount: grossTotal(invoice) });
      return lines;
    }
    case 'BANK_TRANSACTION': {
      const p = (event as BusinessEvent<'BANK_TRANSACTION'>).payload;
      if (p.direction === 'CREDIT') {
        return [
          { account: ACCOUNTS.CASH_BANK, side: 'DEBIT', amount: p.amount },
          { account: ACCOUNTS.TRADE_RECEIVABLES, side: 'CREDIT', amount: p.amount },
        ];
      }
      return [
        { account: ACCOUNTS.TRADE_PAYABLES, side: 'DEBIT', amount: p.amount },
        { account: ACCOUNTS.CASH_BANK, side: 'CREDIT', amount: p.amount },
      ];
    }
    // Кадровые и статусные события не порождают проводок.
    case 'ESF_STATUS_CHANGED':
    case 'EMPLOYEE_HIRED':
    case 'EMPLOYEE_TERMINATED':
      return null;
  }
}

function memoFor(event: BusinessEvent): string {
  switch (event.type) {
    case 'ESF_ISSUED': {
      const { invoice } = (event as BusinessEvent<'ESF_ISSUED'>).payload;
      return `Реализация по ЭСФ № ${invoice.number} (${invoice.counterpartyName})`;
    }
    case 'ESF_RECEIVED': {
      const { invoice } = (event as BusinessEvent<'ESF_RECEIVED'>).payload;
      return `Приобретение по ЭСФ № ${invoice.number} (${invoice.counterpartyName})`;
    }
    case 'BANK_TRANSACTION': {
      const p = (event as BusinessEvent<'BANK_TRANSACTION'>).payload;
      return p.direction === 'CREDIT' ? `Поступление: ${p.purposeText}` : `Списание: ${p.purposeText}`;
    }
    default:
      return event.type;
  }
}

/** Проекция одного события в записи налоговых регистров (может быть пусто). */
export function projectTaxRegisterEntries(event: BusinessEvent): readonly TaxRegisterEntry[] {
  switch (event.type) {
    case 'ESF_ISSUED': {
      const { invoice } = (event as BusinessEvent<'ESF_ISSUED'>).payload;
      return [
        {
          id: `tr-${event.id}-ndsoborot`,
          companyId: event.companyId,
          businessEventId: event.id,
          register: 'НДС_ОБОРОТ_РЕАЛИЗАЦИИ',
          period: TaxPeriod.containing('QUARTER', invoice.turnoverDate),
          amount: invoice.totalExVat,
          norm: 'ст. 484 НК РК',
        },
        {
          id: `tr-${event.id}-kpnsgd`,
          companyId: event.companyId,
          businessEventId: event.id,
          register: 'КПН_СГД',
          period: TaxPeriod.containing('YEAR', invoice.turnoverDate),
          amount: invoice.totalExVat,
          norm: 'ст. 313 НК РК',
        },
      ];
    }
    case 'ESF_RECEIVED': {
      const { invoice } = (event as BusinessEvent<'ESF_RECEIVED'>).payload;
      const entries: TaxRegisterEntry[] = [
        {
          id: `tr-${event.id}-kpnvychet`,
          companyId: event.companyId,
          businessEventId: event.id,
          register: 'КПН_ВЫЧЕТЫ',
          period: TaxPeriod.containing('YEAR', invoice.turnoverDate),
          amount: invoice.totalExVat,
          norm: 'НК РК 2026 — вычеты по КПН (статья уточняется, см. TODO_VERIFY)',
        },
      ];
      if (invoice.vatAmount.isPositive()) {
        entries.push({
          id: `tr-${event.id}-ndszachet`,
          companyId: event.companyId,
          businessEventId: event.id,
          register: 'НДС_ЗАЧЁТ',
          period: TaxPeriod.containing('QUARTER', invoice.turnoverDate),
          amount: invoice.vatAmount,
          norm: 'ст. 480 НК РК',
        });
      }
      return entries;
    }
    // Банковские, кадровые и статусные события в налоговые регистры не попадают.
    case 'BANK_TRANSACTION':
    case 'ESF_STATUS_CHANGED':
    case 'EMPLOYEE_HIRED':
    case 'EMPLOYEE_TERMINATED':
      return [];
  }
}

/** Бухгалтерская книга: проекция потока событий. */
export function projectJournal(
  events: readonly BusinessEvent[],
): Result<readonly JournalEntry[], ProjectionError> {
  const results = events.map(projectJournalEntry);
  const combined = all(results);
  if (!combined.ok) return combined;
  return ok(combined.value.filter((e): e is JournalEntry => e !== null));
}

/** Налоговые регистры: независимая проекция того же потока событий. */
export function projectTaxRegisters(events: readonly BusinessEvent[]): readonly TaxRegisterEntry[] {
  return events.flatMap((e) => projectTaxRegisterEntries(e));
}
