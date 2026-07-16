import type { LocalDate, Rate } from '@sana/domain';

/**
 * Законодательство — версионируемые данные, не код (P2).
 * Каждый параметр действует в интервале [validFrom, validTo];
 * validTo === null — действует по настоящее время.
 */
export type LegalParameter<T> = {
  readonly key: string;
  readonly value: T;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
  /** Норма права: «ст. 484 НК РК». */
  readonly norm: string;
  /** Ссылка на акт или URL источника. */
  readonly source: string;
  /** Требует подтверждения экспертом (§10 спецификации) — не полагаться вслепую. */
  readonly todoVerify: boolean;
  /** Версия для Justification.parameterVersion: «vat.rate.standard@2026-01-01». */
  readonly version: string;
};

/** Типизированный ключ: связывает строковый id с типом значения. */
export type ParamKey<T> = {
  readonly id: string;
  /** Фантомное поле для вывода типа; в рантайме отсутствует. */
  readonly __type?: T;
};

export function paramKey<T>(id: string): ParamKey<T> {
  return { id };
}

export type ResolveError =
  | { kind: 'UNKNOWN_KEY'; key: string }
  | { kind: 'NOT_IN_EFFECT'; key: string; asOf: string };

// ---------------------------------------------------------------------------
// Структурированные значения параметров
// ---------------------------------------------------------------------------

/** Срок в днях: календарных или рабочих. */
export type DayCount = {
  readonly days: number;
  readonly kind: 'CALENDAR' | 'WORKING';
};

/** Ставка с потолком базы, выраженным в МЗП. */
export type CappedRateMzp = {
  readonly rate: Rate;
  readonly capMzp: number;
};

export type OpvrParams = CappedRateMzp & {
  /** Родившиеся до этой даты освобождены от ОПВР. */
  readonly exemptIfBornBefore: LocalDate;
};

export type SoParams = {
  readonly rate: Rate;
  readonly base: 'GROSS_MINUS_OPV';
  readonly floorMzp: number;
  readonly capMzp: number;
};

export type SnParams = {
  readonly rate: Rate;
  readonly base: 'GROSS_MINUS_OPV_MINUS_VOSMS';
  /** Зачёт СО отменён с 2026 года. */
  readonly soOffset: boolean;
};

export type IpnStandardDeduction = {
  readonly mrpPerMonth: number;
  readonly mrpAnnualMax: number;
  /** Вычет применяется только при наличии письменного заявления работника. */
  readonly requiresApplication: boolean;
};

/** «День D месяца, отстоящего на N месяцев от конца периода». */
export type PeriodOffsetDate = {
  readonly monthsAfterPeriodEnd: number;
  readonly dayOfMonth: number;
};

export type FilingWindow = {
  readonly opens: PeriodOffsetDate;
  readonly closes: PeriodOffsetDate;
};
