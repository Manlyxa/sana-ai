import { Money, type CurrencyCode } from '../kernel/money';
import type { TaxPeriod } from '../kernel/tax-period';
import { findAccount } from '../accounting/chart-of-accounts';
import type { LedgerEntry } from '../accounting/ledger-entry';
import { sectionTotal, signedBalances, type ReportSection } from './common';

/**
 * ОПиУ (Profit & Loss) — прямой свод оборотов доходных и расходных счетов
 * за период: выручка, расходы по статьям, итоговая прибыль/убыток.
 */

export type ProfitLossStatement = {
  readonly period: TaxPeriod;
  /** Доходы (Кт-обороты доходных счетов, за вычетом сторно). */
  readonly revenue: ReportSection;
  /** Расходы (Дт-обороты расходных счетов, за вычетом сторно). */
  readonly expenses: ReportSection;
  /** Прибыль (положительная) или убыток (отрицательный). */
  readonly profit: Money;
};

export function profitLossStatement(
  entries: readonly LedgerEntry[],
  period: TaxPeriod,
  options: { readonly currency?: CurrencyCode } = {},
): ProfitLossStatement {
  const currency = options.currency ?? 'KZT';
  const balances = signedBalances(entries, currency, (e) => period.contains(e.date));

  const revenueLines = [];
  const expenseLines = [];
  for (const [account, balance] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const def = findAccount(account);
    if (def === null) continue;
    if (def.type === 'REVENUE') {
      revenueLines.push({
        id: `pl:revenue:${account}`,
        account,
        label: def.name,
        amount: Money.ofMinor(-balance.signed, currency), // доход — кредитовый
        entryIds: balance.entryIds,
      });
    } else if (def.type === 'EXPENSE') {
      expenseLines.push({
        id: `pl:expenses:${account}`,
        account,
        label: def.name,
        amount: Money.ofMinor(balance.signed, currency), // расход — дебетовый
        entryIds: balance.entryIds,
      });
    }
  }

  const revenue: ReportSection = {
    title: 'Доходы',
    lines: revenueLines,
    total: sectionTotal(revenueLines, currency),
  };
  const expenses: ReportSection = {
    title: 'Расходы',
    lines: expenseLines,
    total: sectionTotal(expenseLines, currency),
  };
  return { period, revenue, expenses, profit: revenue.total.subtract(expenses.total) };
}
