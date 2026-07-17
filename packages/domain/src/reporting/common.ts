import { Money, type CurrencyCode } from '../kernel/money';
import type { LedgerEntry } from '../accounting/ledger-entry';

/**
 * Shared reporting primitives (Module 4). Every report line carries the
 * ids of the ledger entries that produced it, so Module 5 can trace any
 * number back to its source events.
 */

export type ReportLine = {
  /** Стабильный id строки отчёта: «bs:assets:1030». */
  readonly id: string;
  readonly account: string;
  /** Наименование строки (по-русски). */
  readonly label: string;
  readonly amount: Money;
  /** Проводки, сформировавшие строку. */
  readonly entryIds: readonly string[];
};

export type ReportSection = {
  readonly title: string;
  readonly lines: readonly ReportLine[];
  readonly total: Money;
};

export function sectionTotal(lines: readonly ReportLine[], currency: CurrencyCode): Money {
  return lines.reduce((acc, l) => acc.add(l.amount), Money.zero(currency));
}

export type SignedBalance = {
  /** Дт − Кт в минорных единицах. */
  signed: bigint;
  entryIds: string[];
};

/** Signed (Дт − Кт) balance per account over the given entries. */
export function signedBalances(
  entries: readonly LedgerEntry[],
  currency: CurrencyCode,
  include: (entry: LedgerEntry) => boolean,
): Map<string, SignedBalance> {
  const balances = new Map<string, SignedBalance>();
  for (const entry of entries) {
    if (!include(entry)) continue;
    for (const line of entry.lines) {
      if (line.amount.currency !== currency) continue;
      let acc = balances.get(line.account);
      if (acc === undefined) {
        acc = { signed: 0n, entryIds: [] };
        balances.set(line.account, acc);
      }
      acc.signed += line.side === 'DEBIT' ? line.amount.amount : -line.amount.amount;
      if (!acc.entryIds.includes(entry.id)) acc.entryIds.push(entry.id);
    }
  }
  return balances;
}
