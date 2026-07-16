import type { Money } from '../kernel/money';
import type { TaxPeriod } from '../kernel/tax-period';

/**
 * TaxRegisterEntry — запись налогового регистра (НК РК), параллельная
 * и независимо выводимая проекция того же BusinessEvent (P7).
 * Бухгалтерская и налоговая трактовки расходятся легитимно.
 */

export type TaxRegisterKind =
  | 'НДС_ОБОРОТ_РЕАЛИЗАЦИИ' // облагаемый оборот по реализации
  | 'НДС_ЗАЧЁТ' // НДС, относимый в зачёт
  | 'КПН_СГД' // совокупный годовой доход
  | 'КПН_ВЫЧЕТЫ'; // вычеты по КПН

export type TaxRegisterEntry = {
  readonly id: string;
  readonly companyId: string;
  /** Событие, проекцией которого является запись. */
  readonly businessEventId: string;
  readonly register: TaxRegisterKind;
  /** Налоговый период, к которому относится запись (НДС — квартал, КПН — год). */
  readonly period: TaxPeriod;
  readonly amount: Money;
  /** Норма права, по которой сумма попадает в регистр (P3). */
  readonly norm: string;
};
