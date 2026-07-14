import type { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import type { Rate } from '../kernel/rate';

/**
 * Параметры законодательства, необходимые зарплатному движку.
 * Домен НЕ обращается к @sana/legal-params (направление зависимостей P5):
 * снимок параметров на месяц расчёта собирает вызывающий слой
 * (buildPayrollLawParams в @sana/legal-params).
 */
export type PayrollLawParams = {
  /** Для Justification.parameterVersion. */
  readonly version: string;
  readonly mrp: Money;
  readonly mzp: Money;
  readonly opv: { readonly rate: Rate; readonly capMzp: number };
  readonly vosms: { readonly rate: Rate; readonly capMzp: number };
  readonly opvr: {
    readonly rate: Rate;
    readonly capMzp: number;
    readonly exemptIfBornBefore: LocalDate;
  };
  readonly so: { readonly rate: Rate; readonly floorMzp: number; readonly capMzp: number };
  readonly oosms: { readonly rate: Rate; readonly capMzp: number };
  readonly sn: { readonly rate: Rate };
  readonly ipn: {
    readonly bracket1Rate: Rate;
    /** Годовой накопительный потолок 1-й ступени, в МРП (8500). */
    readonly bracket1CeilingMrp: number;
    readonly bracket2Rate: Rate;
    /** Стандартный вычет, МРП/мес (30) — только при заявлении. */
    readonly standardDeductionMrpPerMonth: number;
    /** Годовой максимум стандартного вычета, МРП (360). */
    readonly standardDeductionMrpAnnualMax: number;
    /** Дополнительный годовой вычет для инвалидов, МРП (882, TODO_VERIFY). */
    readonly additionalDeductionDisabilityMrpAnnual: number;
  };
};

/**
 * Накопительный итог по работнику с начала года (месяцы 1..N−1).
 * ИПН прогрессивен и накопителен — месяц НЕЛЬЗЯ посчитать изолированно.
 */
export type YtdRecord = {
  readonly cumTaxableIncome: Money;
  readonly cumIpn: Money;
  /** Использованная часть дополнительного (882 МРП) вычета за год. */
  readonly cumAdditionalDeductionUsed: Money;
};

export function emptyYtd(): YtdRecord {
  return {
    cumTaxableIncome: Money.zero(),
    cumIpn: Money.zero(),
    cumAdditionalDeductionUsed: Money.zero(),
  };
}
