import { describe, expect, it } from 'vitest';
import { TaxPeriod } from './tax-period';
import { LocalDate } from './local-date';
import { unwrap } from './result';

describe('TaxPeriod', () => {
  it('границы месяца', () => {
    const feb = TaxPeriod.month(2026, 2);
    expect(feb.start().toISO()).toBe('2026-02-01');
    expect(feb.end().toISO()).toBe('2026-02-28');
    expect(TaxPeriod.month(2024, 2).end().toISO()).toBe('2024-02-29');
  });

  it('границы квартала (период НДС, ф.300)', () => {
    const q1 = TaxPeriod.quarter(2026, 1);
    expect(q1.start().toISO()).toBe('2026-01-01');
    expect(q1.end().toISO()).toBe('2026-03-31');
    const q4 = TaxPeriod.quarter(2026, 4);
    expect(q4.start().toISO()).toBe('2026-10-01');
    expect(q4.end().toISO()).toBe('2026-12-31');
  });

  it('границы полугодия (ф.910) и года (ф.100)', () => {
    const h1 = TaxPeriod.halfYear(2026, 1);
    expect(h1.start().toISO()).toBe('2026-01-01');
    expect(h1.end().toISO()).toBe('2026-06-30');
    const h2 = TaxPeriod.halfYear(2026, 2);
    expect(h2.start().toISO()).toBe('2026-07-01');
    expect(h2.end().toISO()).toBe('2026-12-31');
    const y = TaxPeriod.year(2026);
    expect(y.start().toISO()).toBe('2026-01-01');
    expect(y.end().toISO()).toBe('2026-12-31');
  });

  it('containing определяет период по дате', () => {
    const d = LocalDate.of(2026, 8, 15);
    expect(TaxPeriod.containing('MONTH', d).code()).toBe('2026-M08');
    expect(TaxPeriod.containing('QUARTER', d).code()).toBe('2026-Q3');
    expect(TaxPeriod.containing('HALF_YEAR', d).code()).toBe('2026-H2');
    expect(TaxPeriod.containing('YEAR', d).code()).toBe('2026');
    expect(TaxPeriod.containing('HALF_YEAR', LocalDate.of(2026, 6, 30)).index).toBe(1);
  });

  it('contains', () => {
    const q2 = TaxPeriod.quarter(2026, 2);
    expect(q2.contains(LocalDate.of(2026, 4, 1))).toBe(true);
    expect(q2.contains(LocalDate.of(2026, 6, 30))).toBe(true);
    expect(q2.contains(LocalDate.of(2026, 7, 1))).toBe(false);
    expect(q2.contains(LocalDate.of(2026, 3, 31))).toBe(false);
  });

  it('next/previous переходят через границу года', () => {
    expect(TaxPeriod.quarter(2026, 4).next().code()).toBe('2027-Q1');
    expect(TaxPeriod.quarter(2026, 1).previous().code()).toBe('2025-Q4');
    expect(TaxPeriod.month(2026, 12).next().code()).toBe('2027-M01');
    expect(TaxPeriod.month(2026, 1).previous().code()).toBe('2025-M12');
    expect(TaxPeriod.year(2026).next().code()).toBe('2027');
    expect(TaxPeriod.year(2026).previous().code()).toBe('2025');
  });

  it('months раскладывает период на месяцы (для накопительного ИПН)', () => {
    expect(TaxPeriod.quarter(2026, 3).months().map((m) => m.code())).toEqual([
      '2026-M07',
      '2026-M08',
      '2026-M09',
    ]);
    expect(TaxPeriod.year(2026).months()).toHaveLength(12);
    expect(TaxPeriod.month(2026, 5).months().map((m) => m.code())).toEqual(['2026-M05']);
  });

  it('parse — обратен code', () => {
    for (const code of ['2026', '2026-M03', '2026-Q1', '2026-H2']) {
      expect(unwrap(TaxPeriod.parse(code)).code()).toBe(code);
    }
    expect(TaxPeriod.parse('2026-M13').ok).toBe(false);
    expect(TaxPeriod.parse('2026-Q5').ok).toBe(false);
    expect(TaxPeriod.parse('junk').ok).toBe(false);
  });

  it('отвергает индексы вне диапазона', () => {
    expect(() => TaxPeriod.month(2026, 0)).toThrow(RangeError);
    expect(() => TaxPeriod.quarter(2026, 5)).toThrow(RangeError);
    expect(() => TaxPeriod.halfYear(2026, 3)).toThrow(RangeError);
    expect(() => TaxPeriod.of('YEAR', 2026, 2)).toThrow(RangeError);
    expect(() => TaxPeriod.of('MONTH', 2026.5, 1)).toThrow(RangeError);
  });

  it('equals и compareTo', () => {
    expect(TaxPeriod.quarter(2026, 1).equals(TaxPeriod.quarter(2026, 1))).toBe(true);
    expect(TaxPeriod.quarter(2026, 1).equals(TaxPeriod.month(2026, 1))).toBe(false);
    expect(TaxPeriod.quarter(2026, 2).compareTo(TaxPeriod.quarter(2026, 1))).toBeGreaterThan(0);
    expect(TaxPeriod.quarter(2025, 4).compareTo(TaxPeriod.quarter(2026, 1))).toBeLessThan(0);
    expect(() => TaxPeriod.quarter(2026, 1).compareTo(TaxPeriod.year(2026))).toThrow();
  });

  it('toJSON — код периода', () => {
    expect(JSON.stringify(TaxPeriod.quarter(2026, 2))).toBe('"2026-Q2"');
  });
});
