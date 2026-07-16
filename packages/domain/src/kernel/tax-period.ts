import { err, ok, type Result } from './result';
import { LocalDate } from './local-date';

/**
 * TaxPeriod — налоговый период РК: месяц (ИПН/СН, ф.200 помесячно внутри
 * квартала), квартал (НДС ф.300), полугодие (ф.910), год (КПН ф.100).
 */

export type TaxPeriodKind = 'MONTH' | 'QUARTER' | 'HALF_YEAR' | 'YEAR';

const MAX_INDEX: Record<TaxPeriodKind, number> = {
  MONTH: 12,
  QUARTER: 4,
  HALF_YEAR: 2,
  YEAR: 1,
};

const CODE_RE = /^(\d{4})(?:-(M(\d{2})|Q([1-4])|H([1-2])))?$/;

export class TaxPeriod {
  private constructor(
    readonly kind: TaxPeriodKind,
    readonly year: number,
    /** 1-базовый индекс внутри года: месяц 1–12, квартал 1–4, полугодие 1–2, год всегда 1. */
    readonly index: number,
  ) {}

  static of(kind: TaxPeriodKind, year: number, index: number): TaxPeriod {
    if (!Number.isInteger(year) || !Number.isInteger(index)) {
      throw new RangeError(`invalid period: ${kind} ${year}/${index}`);
    }
    if (index < 1 || index > MAX_INDEX[kind]) {
      throw new RangeError(`index out of range for ${kind}: ${index}`);
    }
    return new TaxPeriod(kind, year, index);
  }

  static month(year: number, month: number): TaxPeriod {
    return TaxPeriod.of('MONTH', year, month);
  }

  static quarter(year: number, quarter: number): TaxPeriod {
    return TaxPeriod.of('QUARTER', year, quarter);
  }

  static halfYear(year: number, half: number): TaxPeriod {
    return TaxPeriod.of('HALF_YEAR', year, half);
  }

  static year(year: number): TaxPeriod {
    return TaxPeriod.of('YEAR', year, 1);
  }

  /** Период данного вида, содержащий дату. */
  static containing(kind: TaxPeriodKind, date: LocalDate): TaxPeriod {
    switch (kind) {
      case 'MONTH':
        return TaxPeriod.month(date.year, date.month);
      case 'QUARTER':
        return TaxPeriod.quarter(date.year, Math.ceil(date.month / 3));
      case 'HALF_YEAR':
        return TaxPeriod.halfYear(date.year, date.month <= 6 ? 1 : 2);
      case 'YEAR':
        return TaxPeriod.year(date.year);
    }
  }

  /** Разбор кода: "2026", "2026-M03", "2026-Q1", "2026-H2". */
  static parse(code: string): Result<TaxPeriod, string> {
    const m = CODE_RE.exec(code);
    if (!m) return err(`не код периода: "${code}"`);
    const year = Number(m[1]);
    if (m[3] !== undefined) {
      const month = Number(m[3]);
      if (month < 1 || month > 12) return err(`месяц вне диапазона: "${code}"`);
      return ok(TaxPeriod.month(year, month));
    }
    if (m[4] !== undefined) return ok(TaxPeriod.quarter(year, Number(m[4])));
    if (m[5] !== undefined) return ok(TaxPeriod.halfYear(year, Number(m[5])));
    return ok(TaxPeriod.year(year));
  }

  private get monthSpan(): number {
    return 12 / MAX_INDEX[this.kind];
  }

  start(): LocalDate {
    return LocalDate.of(this.year, (this.index - 1) * this.monthSpan + 1, 1);
  }

  end(): LocalDate {
    return LocalDate.of(this.year, this.index * this.monthSpan, 1).endOfMonth();
  }

  contains(date: LocalDate): boolean {
    return date.isWithin(this.start(), this.end());
  }

  next(): TaxPeriod {
    if (this.index === MAX_INDEX[this.kind]) {
      return new TaxPeriod(this.kind, this.year + 1, 1);
    }
    return new TaxPeriod(this.kind, this.year, this.index + 1);
  }

  previous(): TaxPeriod {
    if (this.index === 1) {
      return new TaxPeriod(this.kind, this.year - 1, MAX_INDEX[this.kind]);
    }
    return new TaxPeriod(this.kind, this.year, this.index - 1);
  }

  /** Месяцы периода — для накопительных расчётов (ИПН). */
  months(): TaxPeriod[] {
    const startMonth = (this.index - 1) * this.monthSpan + 1;
    const result: TaxPeriod[] = [];
    for (let m = startMonth; m < startMonth + this.monthSpan; m++) {
      result.push(TaxPeriod.month(this.year, m));
    }
    return result;
  }

  code(): string {
    switch (this.kind) {
      case 'MONTH':
        return `${this.year}-M${String(this.index).padStart(2, '0')}`;
      case 'QUARTER':
        return `${this.year}-Q${this.index}`;
      case 'HALF_YEAR':
        return `${this.year}-H${this.index}`;
      case 'YEAR':
        return `${this.year}`;
    }
  }

  equals(other: TaxPeriod): boolean {
    return this.kind === other.kind && this.year === other.year && this.index === other.index;
  }

  compareTo(other: TaxPeriod): number {
    if (this.kind !== other.kind) {
      throw new Error(`compareTo: different period kinds ${this.kind} vs ${other.kind}`);
    }
    return this.year !== other.year ? this.year - other.year : this.index - other.index;
  }

  toJSON(): string {
    return this.code();
  }
}
