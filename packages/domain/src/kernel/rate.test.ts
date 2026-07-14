import { describe, expect, it } from 'vitest';
import { Rate } from './rate';

describe('Rate', () => {
  it('целые проценты: 16% = 4/25', () => {
    const r = Rate.percent(16);
    expect(r.numerator).toBe(4n);
    expect(r.denominator).toBe(25n);
    expect(r.toPercentString()).toBe('16%');
  });

  it('дробные проценты без плавающей точки: 3.5% = 7/200', () => {
    const r = Rate.percent('3.5');
    expect(r.numerator).toBe(7n);
    expect(r.denominator).toBe(200n);
    expect(r.toPercentString()).toBe('3.5%');
  });

  it('число с точной десятичной записью допустимо', () => {
    expect(Rate.percent(3.5).equals(Rate.percent('3.5'))).toBe(true);
  });

  it('ноль', () => {
    expect(Rate.percent(0).isZero()).toBe(true);
    expect(Rate.percent('0').equals(Rate.ZERO)).toBe(true);
    expect(Rate.fraction(0n, 5n)).toBe(Rate.ZERO);
  });

  it('fraction нормализует', () => {
    expect(Rate.fraction(20n, 100n).equals(Rate.percent(20))).toBe(true);
  });

  it('отвергает мусор и отрицательные ставки', () => {
    expect(() => Rate.percent('16%')).toThrow(RangeError);
    expect(() => Rate.percent('-5')).toThrow(RangeError);
    expect(() => Rate.percent('abc')).toThrow(RangeError);
    expect(() => Rate.fraction(1n, 0n)).toThrow(RangeError);
    expect(() => Rate.fraction(-1n, 10n)).toThrow(RangeError);
  });

  it('сериализуется в процентную строку', () => {
    expect(JSON.stringify(Rate.percent('2'))).toBe('"2%"');
  });
});
