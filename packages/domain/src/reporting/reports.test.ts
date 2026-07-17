import { describe, expect, it } from 'vitest';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { TaxPeriod } from '../kernel/tax-period';
import { D } from '../testing/fixtures';
import { GeneralLedger } from '../accounting/general-ledger';
import { EMPTY_ANALYTICS, type LedgerEntryInput } from '../accounting/ledger-entry';
import { balanceSheet } from './balance-sheet';
import { cashFlowStatement } from './cash-flow';
import { profitLossStatement } from './profit-loss';

let seq = 0;

function post(ledger: GeneralLedger, dateIso: string, debit: string, credit: string, tenge: number, memo = 'операция'): void {
  seq += 1;
  const input: LedgerEntryInput = {
    id: `rp-${seq}`,
    companyId: 'co-1',
    sourceEventId: `evt-rp-${seq}`,
    date: D(dateIso),
    lines: [
      { account: debit, side: 'DEBIT', amount: Money.ofMajor(tenge) },
      { account: credit, side: 'CREDIT', amount: Money.ofMajor(tenge) },
    ],
    memo,
    analytics: EMPTY_ANALYTICS,
    norm: null,
    legalParamsVersion: 'chart-of-accounts.snr@2026-01-01',
    reversesEntryId: null,
  };
  unwrap(ledger.post(input));
}

/**
 * Демо-книга за 1 квартал 2026:
 *  - уставный капитал 1 000 000 деньгами;
 *  - реализация на 800 000, оплачено 500 000;
 *  - аренда 200 000 (оплачена со счёта);
 *  - покупка основного средства 300 000;
 *  - займ получен 400 000.
 */
function demoLedger(): GeneralLedger {
  const ledger = new GeneralLedger('co-1');
  post(ledger, '2026-01-05', '1030', '5030', 1_000_000, 'Взнос в уставный капитал');
  post(ledger, '2026-01-15', '1210', '6010', 800_000, 'Реализация услуг');
  post(ledger, '2026-02-01', '1030', '1210', 500_000, 'Оплата от покупателя');
  post(ledger, '2026-02-10', '7210', '1030', 200_000, 'Аренда офиса');
  post(ledger, '2026-02-20', '2410', '1030', 300_000, 'Покупка основного средства');
  post(ledger, '2026-03-01', '1030', '4030', 400_000, 'Получен займ');
  return ledger;
}

const Q1 = TaxPeriod.quarter(2026, 1);

describe('ОПиУ (Profit & Loss)', () => {
  it('sums revenue and expenses per account and computes profit', () => {
    const pl = profitLossStatement(demoLedger().entries(), Q1);
    expect(pl.revenue.total.toDecimalString()).toBe('800000.00');
    expect(pl.expenses.total.toDecimalString()).toBe('200000.00');
    expect(pl.profit.toDecimalString()).toBe('600000.00');
    expect(pl.revenue.lines[0]).toMatchObject({ id: 'pl:revenue:6010', account: '6010' });
    expect(pl.expenses.lines[0]?.entryIds).toHaveLength(1);
  });

  it('a reversing entry nets revenue back out', () => {
    const ledger = demoLedger();
    const saleId = ledger.entries().find((e) => e.memo === 'Реализация услуг')!.id;
    unwrap(ledger.postCorrection({ originalEntryId: saleId, id: 'st-1', date: D('2026-03-15'), reason: 'ошибка' }));
    const pl = profitLossStatement(ledger.entries(), Q1);
    expect(pl.revenue.total.isZero()).toBe(true);
    expect(pl.profit.toDecimalString()).toBe('-200000.00');
  });
});

describe('Balance Sheet', () => {
  it('holds Assets = Liabilities + Equity and mirrors P&L profit in equity', () => {
    const entries = demoLedger().entries();
    const bs = balanceSheet(entries, D('2026-03-31'));
    expect(bs.balanced).toBe(true);
    // Активы: 1030 = 1 000 000 + 500 000 − 200 000 − 300 000 + 400 000 = 1 400 000
    const bank = bs.assets.lines.find((l) => l.account === '1030');
    expect(bank?.amount.toDecimalString()).toBe('1400000.00');
    expect(bs.assets.total.toDecimalString()).toBe('2000000.00'); // + 1210: 300 000, + ОС: 300 000
    expect(bs.liabilities.total.toDecimalString()).toBe('400000.00');
    // Прибыль из ОПиУ увеличивает капитал в балансе.
    const pl = profitLossStatement(entries, Q1);
    const currentProfit = bs.equity.lines.find((l) => l.id === 'bs:equity:current-profit');
    expect(currentProfit?.amount.equals(pl.profit)).toBe(true);
    expect(bs.equity.total.toDecimalString()).toBe('1600000.00');
  });

  it('stays balanced as of any date', () => {
    const entries = demoLedger().entries();
    for (const iso of ['2026-01-05', '2026-01-31', '2026-02-15', '2026-12-31']) {
      expect(balanceSheet(entries, D(iso)).balanced).toBe(true);
    }
  });
});

describe('Cash Flow Statement (direct method)', () => {
  it('classifies flows into operating/investing/financing and reconciles with cash', () => {
    const cf = cashFlowStatement(demoLedger().entries(), Q1);
    expect(cf.operating.net.toDecimalString()).toBe('300000.00'); // +500 000 − 200 000
    expect(cf.investing.net.toDecimalString()).toBe('-300000.00');
    expect(cf.financing.net.toDecimalString()).toBe('1400000.00'); // капитал + займ
    expect(cf.netChange.toDecimalString()).toBe('1400000.00');
    expect(cf.openingCash.isZero()).toBe(true);
    expect(cf.closingCash.toDecimalString()).toBe('1400000.00');
    expect(cf.consistent).toBe(true);
    expect(cf.operating.items.every((i) => i.entryId.length > 0)).toBe(true);
  });

  it('carries opening cash into later periods', () => {
    const ledger = demoLedger();
    post(ledger, '2026-04-02', '7210', '1030', 100_000, 'Аренда апреля');
    const q2 = cashFlowStatement(ledger.entries(), TaxPeriod.quarter(2026, 2));
    expect(q2.openingCash.toDecimalString()).toBe('1400000.00');
    expect(q2.closingCash.toDecimalString()).toBe('1300000.00');
    expect(q2.netChange.toDecimalString()).toBe('-100000.00');
    expect(q2.consistent).toBe(true);
  });
});

describe('cross-report consistency', () => {
  it('the three reports derived from the same entries agree', () => {
    const entries = demoLedger().entries();
    const bs = balanceSheet(entries, Q1.end());
    const pl = profitLossStatement(entries, Q1);
    const cf = cashFlowStatement(entries, Q1);
    // Баланс сходится; прибыль ОПиУ сидит в капитале; деньги баланса = закрытие ОДДС.
    expect(bs.balanced).toBe(true);
    const equityProfit = bs.equity.lines.find((l) => l.id === 'bs:equity:current-profit');
    expect(equityProfit?.amount.equals(pl.profit)).toBe(true);
    const cashInBs = bs.assets.lines
      .filter((l) => l.account === '1010' || l.account === '1030')
      .reduce((acc, l) => acc.add(l.amount), Money.zero());
    expect(cashInBs.equals(cf.closingCash)).toBe(true);
  });
});
