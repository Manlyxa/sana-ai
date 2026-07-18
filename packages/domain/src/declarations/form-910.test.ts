import { describe, expect, it } from 'vitest';
import { createLedgerEntry, buildReversingEntry } from '../accounting/index';
import { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import { Rate } from '../kernel/rate';
import { unwrap } from '../kernel/result';
import { TaxPeriod } from '../kernel/tax-period';
import { computeForm910, revenueForPeriod, type Form910Params } from './form-910';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const H1 = TaxPeriod.halfYear(2026, 1);

const params: Form910Params = {
  rate: Rate.percent(4),
  incomeLimitMrp: 600_000,
  mrp: Money.ofMajor(4_325),
  filingDue: { monthsAfterPeriodEnd: 2, dayOfMonth: 15 },
  version: 'legal-params@test',
};

let seq = 0;
function saleEntry(dateIso: string, tenge: number) {
  seq += 1;
  return unwrap(
    createLedgerEntry({
      id: `sale-${seq}`,
      companyId: 'demo-too',
      sourceEventId: `ev-${seq}`,
      date: D(dateIso),
      lines: [
        { account: '1210', side: 'DEBIT', amount: Money.ofMajor(tenge) },
        { account: '6010', side: 'CREDIT', amount: Money.ofMajor(tenge) },
      ],
      memo: 'реализация',
      analytics: { counterpartyBin: null, counterpartyName: null, category: null },
      norm: null,
      legalParamsVersion: 'test',
      reversesEntryId: null,
    }),
  );
}

describe('форма 910.00 из проводок реестра', () => {
  it('доход — только доходные счета внутри периода; налог = доход × ставка', () => {
    const entries = [
      saleEntry('2026-02-10', 10_000_000),
      saleEntry('2026-05-20', 24_800_000),
      saleEntry('2026-08-01', 7_000_000), // второе полугодие — не входит
    ];
    const form = unwrap(computeForm910(entries, H1, params));
    expect(form.income.toDecimalString()).toBe('34800000.00');
    expect(form.tax.toDecimalString()).toBe('1392000.00'); // 4%
    expect(form.filingDeadline.toISO()).toBe('2026-08-15'); // ст. 728 НК РК
    expect(form.revenueEntryIds).toHaveLength(2);
    expect(form.limitExceeded).toBe(false);
    expect(form.norm).toContain('ст. 722');
  });

  it('сторно реализации уменьшает доход декларации', () => {
    const sale = saleEntry('2026-03-01', 5_000_000);
    const reversal = unwrap(
      buildReversingEntry(sale, { id: 'storno-1', date: D('2026-03-15'), reason: 'ошибка' }),
    );
    const { income } = revenueForPeriod([sale, reversal], H1);
    expect(income.isZero()).toBe(true);
  });

  it('превышение предела дохода СНР помечается', () => {
    // Предел = 600 000 МРП × 4325 = 2 595 000 000 ₸.
    const entries = [saleEntry('2026-04-01', 2_600_000_000)];
    const form = unwrap(computeForm910(entries, H1, params));
    expect(form.limitExceeded).toBe(true);
  });

  it('не-полугодие отвергается', () => {
    expect(computeForm910([], TaxPeriod.quarter(2026, 2), params).ok).toBe(false);
  });
});
