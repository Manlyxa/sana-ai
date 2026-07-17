import { Money, type CurrencyCode } from '../kernel/money';
import type { TaxPeriod } from '../kernel/tax-period';
import type { LedgerEntry } from '../accounting/ledger-entry';

/**
 * Cash Flow Statement — direct method over bank/cash journal entries.
 * Sections: операционная, инвестиционная, финансовая деятельность.
 *
 * Classification is by counter-account: движения с 2410 — инвестиционные,
 * с 4030/5030 — финансовые, всё остальное — операционные.
 */

/** Денежные счета: касса и текущие банковские счета. */
const CASH_ACCOUNTS: ReadonlySet<string> = new Set(['1010', '1030']);
/** Инвестиционная деятельность: основные средства. */
const INVESTING_ACCOUNTS: ReadonlySet<string> = new Set(['2410']);
/** Финансовая деятельность: займы и капитал. */
const FINANCING_ACCOUNTS: ReadonlySet<string> = new Set(['4030', '5030']);

export type CashFlowActivity = 'OPERATING' | 'INVESTING' | 'FINANCING';

export type CashFlowItem = {
  readonly id: string;
  readonly activity: CashFlowActivity;
  /** Контр-счёт движения денег. */
  readonly counterAccount: string;
  readonly memo: string;
  /** Положительная — приток, отрицательная — отток. */
  readonly amount: Money;
  readonly entryId: string;
};

export type CashFlowSection = {
  readonly title: string;
  readonly activity: CashFlowActivity;
  readonly items: readonly CashFlowItem[];
  readonly net: Money;
};

export type CashFlowStatement = {
  readonly period: TaxPeriod;
  readonly operating: CashFlowSection;
  readonly investing: CashFlowSection;
  readonly financing: CashFlowSection;
  readonly openingCash: Money;
  readonly closingCash: Money;
  /** Σ трёх разделов. */
  readonly netChange: Money;
  /** netChange = closingCash − openingCash. */
  readonly consistent: boolean;
};

function activityFor(counterAccount: string): CashFlowActivity {
  if (INVESTING_ACCOUNTS.has(counterAccount)) return 'INVESTING';
  if (FINANCING_ACCOUNTS.has(counterAccount)) return 'FINANCING';
  return 'OPERATING';
}

function cashBalance(entries: readonly LedgerEntry[], currency: CurrencyCode, upTo: (e: LedgerEntry) => boolean): Money {
  let signed = 0n;
  for (const entry of entries) {
    if (!upTo(entry)) continue;
    for (const line of entry.lines) {
      if (!CASH_ACCOUNTS.has(line.account) || line.amount.currency !== currency) continue;
      signed += line.side === 'DEBIT' ? line.amount.amount : -line.amount.amount;
    }
  }
  return Money.ofMinor(signed, currency);
}

export function cashFlowStatement(
  entries: readonly LedgerEntry[],
  period: TaxPeriod,
  options: { readonly currency?: CurrencyCode } = {},
): CashFlowStatement {
  const currency = options.currency ?? 'KZT';
  const start = period.start();
  const items: CashFlowItem[] = [];

  for (const entry of entries) {
    if (!period.contains(entry.date)) continue;
    const cashLines = entry.lines.filter((l) => CASH_ACCOUNTS.has(l.account) && l.amount.currency === currency);
    if (cashLines.length === 0) continue;
    const counterLines = entry.lines.filter((l) => !CASH_ACCOUNTS.has(l.account) && l.amount.currency === currency);
    // Направление движения денег — сторона денежной строки.
    for (const cash of cashLines) {
      const inflow = cash.side === 'DEBIT';
      // Прямой метод: движение относится на контр-счета пропорционально их суммам.
      const counterTotal = counterLines.reduce((acc, l) => acc + l.amount.amount, 0n);
      for (const counter of counterLines) {
        const share =
          counterTotal === 0n ? cash.amount.amount : (cash.amount.amount * counter.amount.amount) / counterTotal;
        const signed = inflow ? share : -share;
        items.push({
          id: `cf:${entry.id}:${counter.account}`,
          activity: activityFor(counter.account),
          counterAccount: counter.account,
          memo: entry.memo,
          amount: Money.ofMinor(signed, currency),
          entryId: entry.id,
        });
      }
    }
  }

  const section = (activity: CashFlowActivity, title: string): CashFlowSection => {
    const sectionItems = items.filter((i) => i.activity === activity);
    return {
      title,
      activity,
      items: sectionItems,
      net: sectionItems.reduce((acc, i) => acc.add(i.amount), Money.zero(currency)),
    };
  };

  const operating = section('OPERATING', 'Операционная деятельность');
  const investing = section('INVESTING', 'Инвестиционная деятельность');
  const financing = section('FINANCING', 'Финансовая деятельность');

  const openingCash = cashBalance(entries, currency, (e) => e.date.isBefore(start));
  const closingCash = cashBalance(entries, currency, (e) => !e.date.isAfter(period.end()));
  const netChange = operating.net.add(investing.net).add(financing.net);

  return {
    period,
    operating,
    investing,
    financing,
    openingCash,
    closingCash,
    netChange,
    consistent: closingCash.subtract(openingCash).equals(netChange),
  };
}
