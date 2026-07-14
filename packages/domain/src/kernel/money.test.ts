import { describe, expect, it } from 'vitest';
import { Money } from './money';
import { Rate } from './rate';

describe('Money', () => {
  it('хранит тиыны как bigint; ofMajor переводит тенге в тиыны', () => {
    expect(Money.ofMajor(100).amount).toBe(10000n);
    expect(Money.ofMinor(150).amount).toBe(150n);
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.ofMajor(85000).currency).toBe('KZT');
  });

  it('отвергает нецелые и небезопасные числа', () => {
    expect(() => Money.ofMinor(1.5)).toThrow(RangeError);
    expect(() => Money.ofMajor(0.1)).toThrow(RangeError);
    expect(() => Money.ofMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('add/subtract/multiply', () => {
    const a = Money.ofMajor(200_000);
    const b = Money.ofMajor(50_000);
    expect(a.add(b).equals(Money.ofMajor(250_000))).toBe(true);
    expect(a.subtract(b).equals(Money.ofMajor(150_000))).toBe(true);
    expect(b.multiply(3).equals(Money.ofMajor(150_000))).toBe(true);
    expect(b.multiply(-1n).equals(Money.ofMajor(-50_000))).toBe(true);
  });

  it('запрещает операции между валютами', () => {
    const kzt = Money.ofMajor(1, 'KZT');
    const usd = Money.ofMajor(1, 'USD');
    expect(() => kzt.add(usd)).toThrow(/currency mismatch/);
    expect(() => kzt.compareTo(usd)).toThrow(/currency mismatch/);
    expect(kzt.equals(usd)).toBe(false);
  });

  it('percent: НДС 16% от 1 000 000 ₸ = 160 000 ₸', () => {
    const base = Money.ofMajor(1_000_000);
    expect(base.percent(Rate.percent(16)).equals(Money.ofMajor(160_000))).toBe(true);
  });

  it('percent: округление до тиына HALF_UP по умолчанию', () => {
    // 10% от 15 тиын = 1.5 тиына → 2 тиына
    expect(Money.ofMinor(15).percent(Rate.percent(10)).amount).toBe(2n);
    expect(Money.ofMinor(15).percent(Rate.percent(10), 'DOWN').amount).toBe(1n);
    // 3.5% от 333 333 ₸ = 11 666.655 ₸ → 1 166 666 тиын (HALF_UP на .5 тиына выше)
    expect(Money.ofMajor(333_333).percent(Rate.percent('3.5')).amount).toBe(1_166_666n);
  });

  it('roundToMajor: суммы налогов в целых тенге', () => {
    expect(Money.ofMinor(12_345).roundToMajor().equals(Money.ofMajor(123))).toBe(true); // 123.45 → 123
    expect(Money.ofMinor(12_350).roundToMajor().equals(Money.ofMajor(124))).toBe(true); // 123.50 → 124
    expect(Money.ofMinor(12_350).roundToMajor('DOWN').equals(Money.ofMajor(123))).toBe(true);
    expect(Money.ofMinor(-12_350).roundToMajor().equals(Money.ofMajor(-124))).toBe(true);
  });

  it('сравнения, min/max, clamp', () => {
    const one = Money.ofMajor(85_000);
    const seven = Money.ofMajor(595_000);
    const low = Money.ofMajor(50_000);
    const mid = Money.ofMajor(300_000);
    const high = Money.ofMajor(900_000);
    expect(Money.min(low, mid).equals(low)).toBe(true);
    expect(Money.max(low, mid).equals(mid)).toBe(true);
    // база СО: clamp(доход − ОПВ, 1 МЗП, 7 МЗП)
    expect(low.clamp(one, seven).equals(one)).toBe(true);
    expect(mid.clamp(one, seven).equals(mid)).toBe(true);
    expect(high.clamp(one, seven).equals(seven)).toBe(true);
    expect(() => mid.clamp(seven, one)).toThrow(RangeError);
  });

  it('negate/abs/знаки', () => {
    const m = Money.ofMajor(-5);
    expect(m.isNegative()).toBe(true);
    expect(m.abs().equals(Money.ofMajor(5))).toBe(true);
    expect(m.negate().isPositive()).toBe(true);
    expect(Money.ofMajor(5).abs().equals(Money.ofMajor(5))).toBe(true);
  });

  it('toDecimalString и toJSON', () => {
    expect(Money.ofMinor(1234567).toDecimalString()).toBe('12345.67');
    expect(Money.ofMinor(-101).toDecimalString()).toBe('-1.01');
    expect(Money.ofMinor(5).toDecimalString()).toBe('0.05');
    expect(Money.ofMajor(1).toJSON()).toEqual({ amount: '100', currency: 'KZT' });
  });
});
