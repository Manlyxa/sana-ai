import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { TaxPeriod } from '../kernel/tax-period';
import { D } from '../testing/fixtures';
import { GeneralLedger } from './general-ledger';
import { EMPTY_ANALYTICS, type LedgerEntryInput } from './ledger-entry';
import { trialBalance } from './trial-balance';

let seq = 0;

function saleEntry(dateIso: string, tenge: number, overrides: Partial<LedgerEntryInput> = {}): LedgerEntryInput {
  seq += 1;
  return {
    id: `le-${seq}`,
    companyId: 'co-1',
    sourceEventId: `evt-${seq}`,
    date: D(dateIso),
    lines: [
      { account: '1210', side: 'DEBIT', amount: Money.ofMajor(tenge) },
      { account: '6010', side: 'CREDIT', amount: Money.ofMajor(tenge) },
    ],
    memo: 'Реализация услуг',
    analytics: EMPTY_ANALYTICS,
    norm: null,
    legalParamsVersion: 'chart-of-accounts.snr@2026-01-01',
    reversesEntryId: null,
    ...overrides,
  };
}

describe('GeneralLedger periods', () => {
  it('rejects postings into a closed period and accepts the next period', () => {
    const ledger = new GeneralLedger('co-1');
    expect(ledger.post(saleEntry('2026-01-15', 100)).ok).toBe(true);
    expect(unwrap(ledger.closePeriod(TaxPeriod.month(2026, 1))).code()).toBe('2026-M01');

    const rejected = ledger.post(saleEntry('2026-01-20', 50));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.kind).toBe('PERIOD_CLOSED');
      expect(rejected.error.message).toContain('сторнирующей проводкой');
    }
    expect(ledger.post(saleEntry('2026-02-01', 50)).ok).toBe(true);
    expect(ledger.isPeriodClosed(TaxPeriod.month(2026, 1))).toBe(true);
    expect(ledger.isPeriodClosed(TaxPeriod.month(2026, 2))).toBe(false);
  });

  it('closes periods strictly in order and never reopens', () => {
    const ledger = new GeneralLedger('co-1');
    unwrap(ledger.closePeriod(TaxPeriod.month(2026, 1)));
    const skip = ledger.closePeriod(TaxPeriod.month(2026, 3));
    expect(skip.ok).toBe(false);
    if (!skip.ok) expect(skip.error.message).toContain('2026-M02');
    const reopen = ledger.closePeriod(TaxPeriod.month(2026, 1));
    expect(reopen.ok).toBe(false);
    expect(() => ledger.closePeriod(TaxPeriod.quarter(2026, 1))).not.toThrow();
    expect(ledger.closePeriod(TaxPeriod.quarter(2026, 1)).ok).toBe(false);
  });

  it('rejects duplicate ids, foreign companies and invalid entries', () => {
    const ledger = new GeneralLedger('co-1');
    expect(ledger.post(saleEntry('2026-01-15', 100, { id: 'dup' })).ok).toBe(true);
    const dup = ledger.post(saleEntry('2026-01-16', 100, { id: 'dup' }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.kind).toBe('DUPLICATE_ID');
    const foreign = ledger.post(saleEntry('2026-01-16', 100, { companyId: 'co-2' }));
    expect(foreign.ok).toBe(false);
    const invalid = ledger.post(
      saleEntry('2026-01-16', 100, {
        lines: [
          { account: '1210', side: 'DEBIT', amount: Money.ofMajor(1) },
          { account: '6010', side: 'CREDIT', amount: Money.ofMajor(2) },
        ],
      }),
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.kind).toBe('INVALID_ENTRY');
  });

  it('corrects a closed-period entry via a reversing entry in the open period', () => {
    const ledger = new GeneralLedger('co-1');
    const original = unwrap(ledger.post(saleEntry('2026-01-15', 100)));
    unwrap(ledger.closePeriod(TaxPeriod.month(2026, 1)));

    const correction = ledger.postCorrection({
      originalEntryId: original.id,
      id: 'le-storno',
      date: D('2026-02-03'),
      reason: 'неверная сумма',
    });
    expect(correction.ok).toBe(true);
    if (correction.ok) {
      expect(correction.value.reversesEntryId).toBe(original.id);
      expect(correction.value.period.code()).toBe('2026-M02');
    }

    const missing = ledger.postCorrection({
      originalEntryId: 'нет-такой',
      id: 'le-x',
      date: D('2026-02-03'),
      reason: 'тест',
    });
    expect(missing.ok).toBe(false);

    // February ОСВ: reversal nets receivables and revenue back to zero.
    const feb = trialBalance(ledger.entries(), TaxPeriod.month(2026, 2));
    const r1210 = feb.rows.find((r) => r.account === '1210');
    expect(r1210?.openingDebit.toDecimalString()).toBe('100.00');
    expect(r1210?.closingDebit.isZero()).toBe(true);
    expect(feb.balanced).toBe(true);
  });

  it('exposes entries per period', () => {
    const ledger = new GeneralLedger('co-1');
    unwrap(ledger.post(saleEntry('2026-01-15', 100)));
    unwrap(ledger.post(saleEntry('2026-02-15', 200)));
    expect(ledger.entriesInPeriod(TaxPeriod.month(2026, 1))).toHaveLength(1);
    expect(ledger.entriesInPeriod(TaxPeriod.quarter(2026, 1))).toHaveLength(2);
    expect(ledger.size).toBe(2);
    expect(ledger.entry('le-none')).toBeNull();
    expect(() => ledger.isPeriodClosed(TaxPeriod.year(2026))).toThrow();
  });
});

describe('double-entry invariant (property)', () => {
  const accountPair = fc.constantFrom<readonly [string, string]>(
    ['1210', '6010'],
    ['1030', '1210'],
    ['7210', '3310'],
    ['3310', '1030'],
    ['1010', '5030'],
  );

  const arbitraryEntry = fc
    .record({
      pair: accountPair,
      tiyn: fc.bigInt({ min: 1n, max: 10_000_000_000n }),
      day: fc.integer({ min: 0, max: 364 }),
    })
    .map(({ pair, tiyn, day }, ) => {
      seq += 1;
      return {
        id: `le-p-${seq}`,
        companyId: 'co-1',
        sourceEventId: `evt-p-${seq}`,
        date: LocalDate.of(2026, 1, 1).plusDays(day),
        lines: [
          { account: pair[0], side: 'DEBIT' as const, amount: Money.ofMinor(tiyn) },
          { account: pair[1], side: 'CREDIT' as const, amount: Money.ofMinor(tiyn) },
        ],
        memo: 'генеративная проводка',
        analytics: EMPTY_ANALYTICS,
        norm: null,
        legalParamsVersion: 'chart-of-accounts.snr@2026-01-01',
        reversesEntryId: null,
      } satisfies LedgerEntryInput;
    });

  it('any accepted entry sequence keeps ОСВ balanced in every month', () => {
    fc.assert(
      fc.property(fc.array(arbitraryEntry, { minLength: 1, maxLength: 40 }), (inputs) => {
        const ledger = new GeneralLedger('co-1');
        for (const input of inputs) unwrap(ledger.post(input));
        for (let month = 1; month <= 12; month++) {
          const tb = trialBalance(ledger.entries(), TaxPeriod.month(2026, month));
          expect(tb.balanced).toBe(true);
        }
        const year = trialBalance(ledger.entries(), TaxPeriod.year(2026));
        expect(year.balanced).toBe(true);
        expect(year.totals.turnoverDebit.equals(year.totals.turnoverCredit)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});
