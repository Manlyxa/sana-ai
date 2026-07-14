/**
 * Правила округления. По умолчанию везде HALF_UP — арифметическое
 * округление «от половины — от нуля», стандарт налоговой практики РК.
 * Любое отклонение от него должно быть явным в вызывающем коде.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

export const KZ_DEFAULT_ROUNDING: RoundingMode = 'HALF_UP';

/**
 * Целочисленное деление n / d с округлением. d > 0.
 * DOWN — к нулю, UP — от нуля, HALF_UP — от нуля при .5,
 * HALF_EVEN — банковское.
 */
export function roundDiv(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d <= 0n) throw new RangeError(`divisor must be positive: ${d}`);
  const q = n / d; // усечение к нулю
  const r = n % d;
  if (r === 0n) return q;
  const negative = n < 0n;
  const absRemainderTwice = (r < 0n ? -r : r) * 2n;
  const bump = negative ? q - 1n : q + 1n;
  switch (mode) {
    case 'DOWN':
      return q;
    case 'UP':
      return bump;
    case 'HALF_UP':
      return absRemainderTwice >= d ? bump : q;
    case 'HALF_EVEN': {
      if (absRemainderTwice > d) return bump;
      if (absRemainderTwice < d) return q;
      return q % 2n === 0n ? q : bump;
    }
  }
}
