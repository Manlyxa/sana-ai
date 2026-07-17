import { Money, type CurrencyCode } from '../kernel/money';
import type { TaxPeriod } from '../kernel/tax-period';
import { findAccount } from './chart-of-accounts';
import type { LedgerEntry } from './ledger-entry';

/**
 * ОСВ (оборотно-сальдовая ведомость) — pure projection of ledger entries
 * for an arbitrary period: opening balance, Дт/Кт turnover and closing
 * balance per account plus company-wide totals.
 *
 * Invariant: в сбалансированной книге итоги Дт = итогам Кт в каждой паре
 * колонок (сальдо начальное, обороты, сальдо конечное).
 */

export type TrialBalanceRow = {
  readonly account: string;
  /** Наименование счёта из рабочего плана счетов. */
  readonly accountName: string;
  readonly openingDebit: Money;
  readonly openingCredit: Money;
  readonly turnoverDebit: Money;
  readonly turnoverCredit: Money;
  readonly closingDebit: Money;
  readonly closingCredit: Money;
  /** id проводок, сформировавших обороты периода (для «объясни цифру»). */
  readonly entryIds: readonly string[];
};

export type TrialBalance = {
  readonly period: TaxPeriod;
  readonly rows: readonly TrialBalanceRow[];
  readonly totals: {
    readonly openingDebit: Money;
    readonly openingCredit: Money;
    readonly turnoverDebit: Money;
    readonly turnoverCredit: Money;
    readonly closingDebit: Money;
    readonly closingCredit: Money;
  };
  /** Дт = Кт по всем трём парам колонок. */
  readonly balanced: boolean;
};

export type SubledgerFilter = {
  readonly counterpartyBin?: string;
  readonly category?: string;
};

function matches(entry: LedgerEntry, filter: SubledgerFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.counterpartyBin !== undefined && entry.analytics.counterpartyBin !== filter.counterpartyBin) {
    return false;
  }
  if (filter.category !== undefined && entry.analytics.category !== filter.category) {
    return false;
  }
  return true;
}

type Accumulator = {
  opening: bigint; // signed: Дт − Кт
  turnoverDebit: bigint;
  turnoverCredit: bigint;
  entryIds: string[];
};

/** Signed balance split into ОСВ columns: positive → Дт, negative → Кт. */
function split(signed: bigint, currency: CurrencyCode): { debit: Money; credit: Money } {
  return signed >= 0n
    ? { debit: Money.ofMinor(signed, currency), credit: Money.zero(currency) }
    : { debit: Money.zero(currency), credit: Money.ofMinor(-signed, currency) };
}

export function trialBalance(
  entries: readonly LedgerEntry[],
  period: TaxPeriod,
  options: { readonly currency?: CurrencyCode; readonly filter?: SubledgerFilter } = {},
): TrialBalance {
  const currency = options.currency ?? 'KZT';
  const start = period.start();
  const accounts = new Map<string, Accumulator>();

  const get = (account: string): Accumulator => {
    let acc = accounts.get(account);
    if (acc === undefined) {
      acc = { opening: 0n, turnoverDebit: 0n, turnoverCredit: 0n, entryIds: [] };
      accounts.set(account, acc);
    }
    return acc;
  };

  for (const entry of entries) {
    if (!matches(entry, options.filter)) continue;
    const before = entry.date.isBefore(start);
    const inside = period.contains(entry.date);
    if (!before && !inside) continue;
    for (const line of entry.lines) {
      if (line.amount.currency !== currency) continue;
      const acc = get(line.account);
      const signed = line.side === 'DEBIT' ? line.amount.amount : -line.amount.amount;
      if (before) {
        acc.opening += signed;
      } else {
        if (line.side === 'DEBIT') acc.turnoverDebit += line.amount.amount;
        else acc.turnoverCredit += line.amount.amount;
        if (!acc.entryIds.includes(entry.id)) acc.entryIds.push(entry.id);
      }
    }
  }

  const rows: TrialBalanceRow[] = [...accounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, acc]) => {
      const opening = split(acc.opening, currency);
      const closing = split(acc.opening + acc.turnoverDebit - acc.turnoverCredit, currency);
      return {
        account,
        accountName: findAccount(account)?.name ?? 'счёт вне рабочего плана счетов',
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        turnoverDebit: Money.ofMinor(acc.turnoverDebit, currency),
        turnoverCredit: Money.ofMinor(acc.turnoverCredit, currency),
        closingDebit: closing.debit,
        closingCredit: closing.credit,
        entryIds: acc.entryIds,
      };
    });

  const sum = (pick: (r: TrialBalanceRow) => Money): Money =>
    rows.reduce((total, r) => total.add(pick(r)), Money.zero(currency));

  const totals = {
    openingDebit: sum((r) => r.openingDebit),
    openingCredit: sum((r) => r.openingCredit),
    turnoverDebit: sum((r) => r.turnoverDebit),
    turnoverCredit: sum((r) => r.turnoverCredit),
    closingDebit: sum((r) => r.closingDebit),
    closingCredit: sum((r) => r.closingCredit),
  };

  return {
    period,
    rows,
    totals,
    balanced:
      totals.openingDebit.equals(totals.openingCredit) &&
      totals.turnoverDebit.equals(totals.turnoverCredit) &&
      totals.closingDebit.equals(totals.closingCredit),
  };
}
