import { describe, expect, it } from 'vitest';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { TaxPeriod } from '../kernel/tax-period';
import { D, TEST_BIN_2 } from '../testing/fixtures';
import { GeneralLedger } from './general-ledger';
import { EMPTY_ANALYTICS, type LedgerEntryInput, type PostingAnalytics } from './ledger-entry';
import { trialBalance } from './trial-balance';

let seq = 0;

function post(
  ledger: GeneralLedger,
  dateIso: string,
  debit: string,
  credit: string,
  tenge: number,
  analytics: PostingAnalytics = EMPTY_ANALYTICS,
): void {
  seq += 1;
  const input: LedgerEntryInput = {
    id: `tb-${seq}`,
    companyId: 'co-1',
    sourceEventId: `evt-tb-${seq}`,
    date: D(dateIso),
    lines: [
      { account: debit, side: 'DEBIT', amount: Money.ofMajor(tenge) },
      { account: credit, side: 'CREDIT', amount: Money.ofMajor(tenge) },
    ],
    memo: 'тестовая проводка',
    analytics,
    norm: null,
    legalParamsVersion: 'chart-of-accounts.snr@2026-01-01',
    reversesEntryId: null,
  };
  unwrap(ledger.post(input));
}

function build(): GeneralLedger {
  const ledger = new GeneralLedger('co-1');
  // Январь: взнос в уставный капитал, реализация, поступление оплаты.
  post(ledger, '2026-01-05', '1030', '5030', 1_000_000);
  post(ledger, '2026-01-10', '1210', '6010', 500_000);
  post(ledger, '2026-01-20', '1030', '1210', 300_000);
  // Февраль: расходы и оплата поставщику.
  post(ledger, '2026-02-03', '7210', '3310', 120_000, {
    counterpartyBin: TEST_BIN_2.value,
    counterpartyName: 'ТОО «Поставщик»',
    category: 'АРЕНДА',
  });
  post(ledger, '2026-02-10', '3310', '1030', 120_000, {
    counterpartyBin: TEST_BIN_2.value,
    counterpartyName: 'ТОО «Поставщик»',
    category: null,
  });
  return ledger;
}

describe('trialBalance (ОСВ)', () => {
  it('computes per-account turnover and closing balances for a month', () => {
    const tb = trialBalance(build().entries(), TaxPeriod.month(2026, 1));
    const bank = tb.rows.find((r) => r.account === '1030');
    expect(bank?.openingDebit.isZero()).toBe(true);
    expect(bank?.turnoverDebit.toDecimalString()).toBe('1300000.00');
    expect(bank?.closingDebit.toDecimalString()).toBe('1300000.00');
    const receivables = tb.rows.find((r) => r.account === '1210');
    expect(receivables?.turnoverDebit.toDecimalString()).toBe('500000.00');
    expect(receivables?.turnoverCredit.toDecimalString()).toBe('300000.00');
    expect(receivables?.closingDebit.toDecimalString()).toBe('200000.00');
    expect(receivables?.accountName).toContain('дебиторская задолженность');
    expect(tb.balanced).toBe(true);
  });

  it('carries closing balances of a closed month as opening of the next (reconciliation)', () => {
    const ledger = build();
    unwrap(ledger.closePeriod(TaxPeriod.month(2026, 1)));
    const january = trialBalance(ledger.entries(), TaxPeriod.month(2026, 1));
    const february = trialBalance(ledger.entries(), TaxPeriod.month(2026, 2));
    for (const row of january.rows) {
      const next = february.rows.find((r) => r.account === row.account);
      expect(next, `счёт ${row.account} пропал из ОСВ февраля`).toBeDefined();
      expect(next?.openingDebit.equals(row.closingDebit)).toBe(true);
      expect(next?.openingCredit.equals(row.closingCredit)).toBe(true);
    }
    expect(february.balanced).toBe(true);
  });

  it('links turnover to the entry ids that produced it', () => {
    const tb = trialBalance(build().entries(), TaxPeriod.month(2026, 2));
    const admin = tb.rows.find((r) => r.account === '7210');
    expect(admin?.entryIds).toHaveLength(1);
  });

  it('filters the subledger by counterparty and category', () => {
    const entries = build().entries();
    const byCounterparty = trialBalance(entries, TaxPeriod.quarter(2026, 1), {
      filter: { counterpartyBin: TEST_BIN_2.value },
    });
    expect(byCounterparty.rows.map((r) => r.account).sort()).toEqual(['1030', '3310', '7210']);
    const payables = byCounterparty.rows.find((r) => r.account === '3310');
    expect(payables?.closingCredit.isZero()).toBe(true);
    expect(byCounterparty.balanced).toBe(true);

    const byCategory = trialBalance(entries, TaxPeriod.quarter(2026, 1), {
      filter: { category: 'АРЕНДА' },
    });
    expect(byCategory.rows.map((r) => r.account).sort()).toEqual(['3310', '7210']);
  });

  it('works for the whole company over any period kind', () => {
    const year = trialBalance(build().entries(), TaxPeriod.year(2026));
    expect(year.totals.turnoverDebit.toDecimalString()).toBe('2040000.00');
    expect(year.totals.turnoverDebit.equals(year.totals.turnoverCredit)).toBe(true);
  });
});
