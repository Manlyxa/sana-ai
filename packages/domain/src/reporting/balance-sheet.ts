import type { LocalDate } from '../kernel/local-date';
import { Money, type CurrencyCode } from '../kernel/money';
import { findAccount } from '../accounting/chart-of-accounts';
import type { LedgerEntry } from '../accounting/ledger-entry';
import { sectionTotal, signedBalances, type ReportLine, type ReportSection } from './common';

/**
 * Balance Sheet (бухгалтерский баланс) as of a date, with the structural
 * invariant Assets = Liabilities + Equity.
 *
 * Income accounts are not closed in the MVP, so the current financial
 * result appears in equity as a computed line «Нераспределённая прибыль
 * (текущий результат)» = Σ доходов − Σ расходов накопительно.
 */

export type BalanceSheet = {
  readonly asOf: LocalDate;
  readonly assets: ReportSection;
  readonly liabilities: ReportSection;
  readonly equity: ReportSection;
  /** Assets = Liabilities + Equity. */
  readonly balanced: boolean;
};

export function balanceSheet(
  entries: readonly LedgerEntry[],
  asOf: LocalDate,
  options: { readonly currency?: CurrencyCode } = {},
): BalanceSheet {
  const currency = options.currency ?? 'KZT';
  const balances = signedBalances(entries, currency, (e) => !e.date.isAfter(asOf));

  const assetLines: ReportLine[] = [];
  const liabilityLines: ReportLine[] = [];
  const equityLines: ReportLine[] = [];
  let profitSigned = 0n; // доходы − расходы (в кредитовой конвенции)
  const profitEntryIds: string[] = [];

  for (const [account, balance] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const def = findAccount(account);
    if (def === null) continue;
    switch (def.type) {
      case 'ASSET':
        assetLines.push({
          id: `bs:assets:${account}`,
          account,
          label: def.name,
          amount: Money.ofMinor(balance.signed, currency),
          entryIds: balance.entryIds,
        });
        break;
      case 'LIABILITY':
        liabilityLines.push({
          id: `bs:liabilities:${account}`,
          account,
          label: def.name,
          amount: Money.ofMinor(-balance.signed, currency),
          entryIds: balance.entryIds,
        });
        break;
      case 'EQUITY':
        equityLines.push({
          id: `bs:equity:${account}`,
          account,
          label: def.name,
          amount: Money.ofMinor(-balance.signed, currency),
          entryIds: balance.entryIds,
        });
        break;
      case 'REVENUE':
      case 'EXPENSE':
        profitSigned += -balance.signed;
        for (const id of balance.entryIds) {
          if (!profitEntryIds.includes(id)) profitEntryIds.push(id);
        }
        break;
    }
  }

  equityLines.push({
    id: 'bs:equity:current-profit',
    account: '5510',
    label: 'Нераспределённая прибыль (текущий результат)',
    amount: Money.ofMinor(profitSigned, currency),
    entryIds: profitEntryIds,
  });

  const assets: ReportSection = { title: 'Активы', lines: assetLines, total: sectionTotal(assetLines, currency) };
  const liabilities: ReportSection = {
    title: 'Обязательства',
    lines: liabilityLines,
    total: sectionTotal(liabilityLines, currency),
  };
  const equity: ReportSection = { title: 'Капитал', lines: equityLines, total: sectionTotal(equityLines, currency) };

  return {
    asOf,
    assets,
    liabilities,
    equity,
    balanced: assets.total.equals(liabilities.total.add(equity.total)),
  };
}
