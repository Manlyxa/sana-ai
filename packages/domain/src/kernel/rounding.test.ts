import { describe, expect, it } from 'vitest';
import { roundDiv } from './rounding';

describe('roundDiv', () => {
  it('точное деление не зависит от режима', () => {
    for (const mode of ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const) {
      expect(roundDiv(10n, 2n, mode)).toBe(5n);
      expect(roundDiv(-10n, 2n, mode)).toBe(-5n);
    }
  });

  it('HALF_UP: половина — от нуля (арифметическое округление РК)', () => {
    expect(roundDiv(5n, 10n, 'HALF_UP')).toBe(1n); // 0.5 → 1
    expect(roundDiv(4n, 10n, 'HALF_UP')).toBe(0n);
    expect(roundDiv(15n, 10n, 'HALF_UP')).toBe(2n);
    expect(roundDiv(-5n, 10n, 'HALF_UP')).toBe(-1n); // -0.5 → -1
    expect(roundDiv(-14n, 10n, 'HALF_UP')).toBe(-1n);
  });

  it('HALF_EVEN: банковское округление', () => {
    expect(roundDiv(5n, 10n, 'HALF_EVEN')).toBe(0n); // 0.5 → 0 (чётное)
    expect(roundDiv(15n, 10n, 'HALF_EVEN')).toBe(2n); // 1.5 → 2
    expect(roundDiv(25n, 10n, 'HALF_EVEN')).toBe(2n); // 2.5 → 2
    expect(roundDiv(26n, 10n, 'HALF_EVEN')).toBe(3n);
    expect(roundDiv(-15n, 10n, 'HALF_EVEN')).toBe(-2n);
    expect(roundDiv(-14n, 10n, 'HALF_EVEN')).toBe(-1n);
  });

  it('DOWN к нулю, UP от нуля', () => {
    expect(roundDiv(19n, 10n, 'DOWN')).toBe(1n);
    expect(roundDiv(-19n, 10n, 'DOWN')).toBe(-1n);
    expect(roundDiv(11n, 10n, 'UP')).toBe(2n);
    expect(roundDiv(-11n, 10n, 'UP')).toBe(-2n);
  });

  it('отвергает неположительный делитель', () => {
    expect(() => roundDiv(1n, 0n, 'HALF_UP')).toThrow(RangeError);
    expect(() => roundDiv(1n, -2n, 'HALF_UP')).toThrow(RangeError);
  });
});
