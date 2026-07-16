/**
 * Rate — точная рациональная ставка (16% = 16/100, 3,5% = 35/1000).
 * Никаких плавающих чисел ни в хранении, ни в применении ставки.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export class Rate {
  private constructor(
    /** Числитель нормализованной дроби. */
    readonly numerator: bigint,
    /** Знаменатель нормализованной дроби, > 0. */
    readonly denominator: bigint,
    /** Исходное текстовое представление в процентах, для отображения. */
    private readonly percentText: string,
  ) {}

  static readonly ZERO = new Rate(0n, 1n, '0');

  /**
   * Ставка в процентах: Rate.percent(16), Rate.percent('3.5').
   * Число допустимо только если его десятичная запись точна (проверяется
   * через toString); иначе передавайте строку.
   */
  static percent(value: number | string): Rate {
    const text = typeof value === 'number' ? String(value) : value;
    const m = DECIMAL_RE.exec(text);
    if (!m) throw new RangeError(`invalid percent literal: "${text}"`);
    const whole = m[1] as string;
    const frac = m[2] ?? '';
    const numerator = BigInt(whole + frac);
    const denominator = 100n * 10n ** BigInt(frac.length);
    if (numerator === 0n) return Rate.ZERO;
    const g = gcd(numerator, denominator);
    return new Rate(numerator / g, denominator / g, text);
  }

  static fraction(numerator: bigint, denominator: bigint): Rate {
    if (denominator <= 0n) throw new RangeError(`denominator must be positive: ${denominator}`);
    if (numerator < 0n) throw new RangeError(`rate must be non-negative: ${numerator}`);
    if (numerator === 0n) return Rate.ZERO;
    const g = gcd(numerator, denominator);
    const n = numerator / g;
    const d = denominator / g;
    return new Rate(n, d, `${(n * 100n) / d}`);
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  equals(other: Rate): boolean {
    return this.numerator === other.numerator && this.denominator === other.denominator;
  }

  /** «16%», «3.5%» — для журналов и Justification. */
  toPercentString(): string {
    return `${this.percentText}%`;
  }

  toJSON(): string {
    return this.toPercentString();
  }
}
