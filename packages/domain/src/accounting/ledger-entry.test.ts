import { describe, expect, it } from 'vitest';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { D } from '../testing/fixtures';
import { CHART_OF_ACCOUNTS, findAccount, isKnownAccount } from './chart-of-accounts';
import {
  buildReversingEntry,
  createLedgerEntry,
  EMPTY_ANALYTICS,
  type LedgerEntryInput,
  type LedgerLine,
} from './ledger-entry';

function entryInput(overrides: Partial<LedgerEntryInput> = {}): LedgerEntryInput {
  return {
    id: 'le-1',
    companyId: 'co-1',
    sourceEventId: 'evt-1',
    date: D('2026-03-10'),
    lines: [
      { account: '1210', side: 'DEBIT', amount: Money.ofMajor(112_000) },
      { account: '6010', side: 'CREDIT', amount: Money.ofMajor(112_000) },
    ],
    memo: 'Реализация услуг',
    analytics: EMPTY_ANALYTICS,
    norm: 'ст. 688 НК РК',
    legalParamsVersion: 'chart-of-accounts.snr@2026-01-01',
    reversesEntryId: null,
    ...overrides,
  };
}

describe('chart of accounts', () => {
  it('has unique codes and Russian names', () => {
    const codes = CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const account of CHART_OF_ACCOUNTS) {
      expect(account.name.length).toBeGreaterThan(3);
    }
  });

  it('derives normal side from account type', () => {
    expect(findAccount('1030')?.normalSide).toBe('DEBIT');
    expect(findAccount('7210')?.normalSide).toBe('DEBIT');
    expect(findAccount('3310')?.normalSide).toBe('CREDIT');
    expect(findAccount('5030')?.normalSide).toBe('CREDIT');
    expect(findAccount('6010')?.normalSide).toBe('CREDIT');
  });

  it('rejects unknown codes', () => {
    expect(isKnownAccount('9999')).toBe(false);
    expect(findAccount('9999')).toBeNull();
  });
});

describe('createLedgerEntry', () => {
  it('accepts a balanced entry and derives the monthly period', () => {
    const entry = unwrap(createLedgerEntry(entryInput()));
    expect(entry.period.code()).toBe('2026-M03');
    expect(entry.lines).toHaveLength(2);
  });

  it('rejects an unbalanced entry', () => {
    const lines: LedgerLine[] = [
      { account: '1210', side: 'DEBIT', amount: Money.ofMajor(100) },
      { account: '6010', side: 'CREDIT', amount: Money.ofMajor(99) },
    ];
    const result = createLedgerEntry(entryInput({ lines }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('не сбалансирована');
  });

  it('rejects entries without a source event reference', () => {
    const result = createLedgerEntry(entryInput({ sourceEventId: ' ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('sourceEventId');
  });

  it('rejects accounts outside the working chart of accounts', () => {
    const lines: LedgerLine[] = [
      { account: '0000', side: 'DEBIT', amount: Money.ofMajor(100) },
      { account: '6010', side: 'CREDIT', amount: Money.ofMajor(100) },
    ];
    const result = createLedgerEntry(entryInput({ lines }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('неизвестный счёт');
  });

  it('rejects non-positive amounts, mixed currencies, single-line and empty ids', () => {
    expect(
      createLedgerEntry(
        entryInput({
          lines: [
            { account: '1210', side: 'DEBIT', amount: Money.zero() },
            { account: '6010', side: 'CREDIT', amount: Money.zero() },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      createLedgerEntry(
        entryInput({
          lines: [
            { account: '1210', side: 'DEBIT', amount: Money.ofMajor(100, 'KZT') },
            { account: '6010', side: 'CREDIT', amount: Money.ofMajor(100, 'USD') },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      createLedgerEntry(
        entryInput({ lines: [{ account: '1210', side: 'DEBIT', amount: Money.ofMajor(1) }] }),
      ).ok,
    ).toBe(false);
    expect(createLedgerEntry(entryInput({ id: '' })).ok).toBe(false);
    expect(createLedgerEntry(entryInput({ companyId: '' })).ok).toBe(false);
  });
});

describe('buildReversingEntry', () => {
  it('swaps sides, keeps amounts and references the original', () => {
    const original = unwrap(createLedgerEntry(entryInput()));
    const reversed = unwrap(
      buildReversingEntry(original, { id: 'le-2', date: D('2026-04-05'), reason: 'ошибка в счёте' }),
    );
    expect(reversed.reversesEntryId).toBe('le-1');
    expect(reversed.period.code()).toBe('2026-M04');
    expect(reversed.memo).toContain('Сторно');
    expect(reversed.lines[0]).toMatchObject({ account: '1210', side: 'CREDIT' });
    expect(reversed.lines[1]).toMatchObject({ account: '6010', side: 'DEBIT' });
    expect(reversed.lines[0]?.amount.equals(Money.ofMajor(112_000))).toBe(true);
  });
});
