import { Rate } from './rate';
import { KZ_DEFAULT_ROUNDING, roundDiv, type RoundingMode } from './rounding';

/**
 * Money — деньги в целых минорных единицах (тиын для KZT).
 * bigint внутри: ни переполнений, ни плавающей точки (P-стек §2).
 *
 * Несовпадение валют и нецелые аргументы — нарушения инвариантов
 * (ошибки программиста), поэтому бросают исключение, а не Result.
 */

export type CurrencyCode = 'KZT' | 'USD' | 'EUR' | 'RUB' | 'CNY';

const MINOR_UNITS_PER_MAJOR = 100n;

function toBigInt(value: bigint | number, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a safe integer, got: ${value}`);
  }
  return BigInt(value);
}

export class Money {
  private constructor(
    /** Сумма в минорных единицах (тиын). */
    readonly amount: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static ofMinor(amount: bigint | number, currency: CurrencyCode = 'KZT'): Money {
    return new Money(toBigInt(amount, 'minor amount'), currency);
  }

  /** Целые тенге → тиын. Для сумм с тиынами используйте ofMinor. */
  static ofMajor(amount: bigint | number, currency: CurrencyCode = 'KZT'): Money {
    return new Money(toBigInt(amount, 'major amount') * MINOR_UNITS_PER_MAJOR, currency);
  }

  static zero(currency: CurrencyCode = 'KZT'): Money {
    return new Money(0n, currency);
  }

  private assertSameCurrency(other: Money, op: string): void {
    if (this.currency !== other.currency) {
      throw new Error(`${op}: currency mismatch ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return new Money(this.amount - other.amount, this.currency);
  }

  /** Умножение на целый коэффициент (количество, месяцы, штуки). */
  multiply(factor: bigint | number): Money {
    return new Money(this.amount * toBigInt(factor, 'factor'), this.currency);
  }

  /** Применение ставки: НДС 16% от базы и т.п. Округление до тиына. */
  percent(rate: Rate, rounding: RoundingMode = KZ_DEFAULT_ROUNDING): Money {
    const raw = this.amount * rate.numerator;
    return new Money(roundDiv(raw, rate.denominator, rounding), this.currency);
  }

  /** Округление до целых тенге (суммы налогов исчисляются в тенге). */
  roundToMajor(rounding: RoundingMode = KZ_DEFAULT_ROUNDING): Money {
    const major = roundDiv(this.amount, MINOR_UNITS_PER_MAJOR, rounding);
    return new Money(major * MINOR_UNITS_PER_MAJOR, this.currency);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  abs(): Money {
    return this.amount < 0n ? this.negate() : this;
  }

  compareTo(other: Money): number {
    this.assertSameCurrency(other, 'compareTo');
    return this.amount < other.amount ? -1 : this.amount > other.amount ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  static min(a: Money, b: Money): Money {
    return a.compareTo(b) <= 0 ? a : b;
  }

  static max(a: Money, b: Money): Money {
    return a.compareTo(b) >= 0 ? a : b;
  }

  /** Зажим в интервал [floor, cap] — базы СО и т.п. */
  clamp(floor: Money, cap: Money): Money {
    if (floor.compareTo(cap) > 0) throw new RangeError('clamp: floor > cap');
    return Money.min(Money.max(this, floor), cap);
  }

  /** «12345.67» — для сериализации; не для арифметики. */
  toDecimalString(): string {
    const negative = this.amount < 0n;
    const abs = negative ? -this.amount : this.amount;
    const major = abs / MINOR_UNITS_PER_MAJOR;
    const minor = abs % MINOR_UNITS_PER_MAJOR;
    return `${negative ? '-' : ''}${major}.${String(minor).padStart(2, '0')}`;
  }

  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.amount.toString(), currency: this.currency };
  }
}
