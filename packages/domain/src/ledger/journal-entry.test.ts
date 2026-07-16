import { describe, expect, it } from 'vitest';
import { createJournalEntry, entryTotal, type JournalEntry } from './journal-entry';
import { ACCOUNTS } from './accounts';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { D } from '../testing/fixtures';

function entry(lines: JournalEntry['lines']): JournalEntry {
  return {
    id: 'je-1',
    companyId: 'co-1',
    businessEventId: 'evt-1',
    date: D('2026-02-10'),
    lines,
    memo: 'тест',
  };
}

describe('JournalEntry', () => {
  it('сбалансированная проводка проходит: Дт 1210 = Кт 6010 + Кт 3130', () => {
    const je = unwrap(
      createJournalEntry(
        entry([
          { account: ACCOUNTS.TRADE_RECEIVABLES, side: 'DEBIT', amount: Money.ofMajor(1_160_000) },
          { account: ACCOUNTS.REVENUE, side: 'CREDIT', amount: Money.ofMajor(1_000_000) },
          { account: ACCOUNTS.VAT_PAYABLE, side: 'CREDIT', amount: Money.ofMajor(160_000) },
        ]),
      ),
    );
    expect(entryTotal(je).equals(Money.ofMajor(1_160_000))).toBe(true);
  });

  it('несбалансированная проводка отвергается', () => {
    const r = createJournalEntry(
      entry([
        { account: '1210', side: 'DEBIT', amount: Money.ofMajor(100) },
        { account: '6010', side: 'CREDIT', amount: Money.ofMajor(99) },
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('≠');
  });

  it('минимум две строки; суммы строго положительны; одна валюта', () => {
    expect(
      createJournalEntry(entry([{ account: '1210', side: 'DEBIT', amount: Money.ofMajor(1) }])).ok,
    ).toBe(false);
    expect(
      createJournalEntry(
        entry([
          { account: '1210', side: 'DEBIT', amount: Money.zero() },
          { account: '6010', side: 'CREDIT', amount: Money.zero() },
        ]),
      ).ok,
    ).toBe(false);
    expect(
      createJournalEntry(
        entry([
          { account: '1210', side: 'DEBIT', amount: Money.ofMajor(1) },
          { account: '6010', side: 'CREDIT', amount: Money.ofMajor(1, 'USD') },
        ]),
      ).ok,
    ).toBe(false);
  });
});
