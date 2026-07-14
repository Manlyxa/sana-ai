import { err, ok, type Result } from './result';

/**
 * LocalDate — календарная дата без времени и часового пояса.
 *
 * Все деловые даты в системе — даты Asia/Almaty. Конвертация из UTC-моментов
 * в календарную дату выполняется на границах системы (адаптеры, API); внутрь
 * домена попадает уже готовая календарная дата. Здесь — только чистая
 * целочисленная арифметика (алгоритмы Говарда Хиннанта), без `Date`.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new RangeError(`month out of range: ${month}`);
  const base = DAYS_IN_MONTH[month - 1] as number;
  return month === 2 && isLeapYear(year) ? 29 : base;
}

/** Дни от эпохи 1970-01-01 (civil-from-days, H. Hinnant). */
function toEpochDay(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromEpochDay(epochDay: number): { year: number; month: number; day: number } {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = понедельник, 7 = воскресенье

export class LocalDate {
  private constructor(
    readonly year: number,
    readonly month: number,
    readonly day: number,
  ) {}

  /** Бросает при невалидной дате — использовать для литералов в коде и тестах. */
  static of(year: number, month: number, day: number): LocalDate {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      throw new RangeError(`invalid date components: ${year}-${month}-${day}`);
    }
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      throw new RangeError(`invalid date: ${year}-${month}-${day}`);
    }
    return new LocalDate(year, month, day);
  }

  /** Безопасный разбор ISO-строки YYYY-MM-DD с внешних границ. */
  static parse(iso: string): Result<LocalDate, string> {
    const m = ISO_RE.exec(iso);
    if (!m) return err(`не ISO-дата (YYYY-MM-DD): "${iso}"`);
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      return err(`несуществующая дата: "${iso}"`);
    }
    return ok(new LocalDate(year, month, day));
  }

  static fromEpochDay(epochDay: number): LocalDate {
    const { year, month, day } = fromEpochDay(epochDay);
    return new LocalDate(year, month, day);
  }

  toEpochDay(): number {
    return toEpochDay(this.year, this.month, this.day);
  }

  toISO(): string {
    const y = String(this.year).padStart(4, '0');
    const m = String(this.month).padStart(2, '0');
    const d = String(this.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  compareTo(other: LocalDate): number {
    return this.toEpochDay() - other.toEpochDay();
  }

  equals(other: LocalDate): boolean {
    return this.compareTo(other) === 0;
  }

  isBefore(other: LocalDate): boolean {
    return this.compareTo(other) < 0;
  }

  isAfter(other: LocalDate): boolean {
    return this.compareTo(other) > 0;
  }

  /** this ∈ [from, to]; to === null означает открытый интервал. */
  isWithin(from: LocalDate, to: LocalDate | null): boolean {
    return !this.isBefore(from) && (to === null || !this.isAfter(to));
  }

  plusDays(days: number): LocalDate {
    if (!Number.isInteger(days)) throw new RangeError(`days must be an integer: ${days}`);
    return LocalDate.fromEpochDay(this.toEpochDay() + days);
  }

  minusDays(days: number): LocalDate {
    return this.plusDays(-days);
  }

  /** День выходит за пределы месяца — прижимается к последнему дню (31 янв + 1 мес = 28/29 фев). */
  plusMonths(months: number): LocalDate {
    if (!Number.isInteger(months)) throw new RangeError(`months must be an integer: ${months}`);
    const total = this.year * 12 + (this.month - 1) + months;
    const year = Math.floor(total / 12);
    const month = (total - year * 12) + 1;
    const day = Math.min(this.day, daysInMonth(year, month));
    return LocalDate.of(year, month, day);
  }

  plusYears(years: number): LocalDate {
    return this.plusMonths(years * 12);
  }

  dayOfWeek(): DayOfWeek {
    const dow = (((this.toEpochDay() + 3) % 7) + 7) % 7;
    return (dow + 1) as DayOfWeek;
  }

  isWeekend(): boolean {
    return this.dayOfWeek() >= 6;
  }

  startOfMonth(): LocalDate {
    return LocalDate.of(this.year, this.month, 1);
  }

  endOfMonth(): LocalDate {
    return LocalDate.of(this.year, this.month, daysInMonth(this.year, this.month));
  }

  toJSON(): string {
    return this.toISO();
  }
}

/** Количество дней от `from` до `to` (положительное, если to позже). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return to.toEpochDay() - from.toEpochDay();
}

/**
 * Добавляет `days` рабочих дней (пропуская сб/вс и праздники).
 * Праздничный календарь РК — версионируемые данные (@sana/legal-params),
 * сюда он передаётся как множество ISO-дат.
 */
export function addWorkingDays(
  start: LocalDate,
  days: number,
  holidays: ReadonlySet<string> = new Set(),
): LocalDate {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`working days must be a non-negative integer: ${days}`);
  }
  let current = start;
  let remaining = days;
  while (remaining > 0) {
    current = current.plusDays(1);
    if (!current.isWeekend() && !holidays.has(current.toISO())) {
      remaining -= 1;
    }
  }
  return current;
}
