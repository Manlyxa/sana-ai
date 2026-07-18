import type { Bin, Iin, LocalDate, Money, Result } from '@sana/domain';
import type { PortError } from './common';

/**
 * Источник данных о начислениях сотрудников (штатное расписание /
 * ведомость). Кадровые факты (даты приёма, регистрация в ЕСУТД)
 * приходят из EnbekPort; здесь — только деньги по месяцам.
 */

export type SalaryRecord = {
  readonly iin: Iin;
  readonly position: string;
  /** Начислено по месяцам года (1–12). Отсутствующий месяц = не работал (0). */
  readonly grossByMonth: ReadonlyMap<number, Money>;
  /** Дата заявления на стандартный вычет 30 МРП; null — заявления нет. */
  readonly ipnDeductionApplicationAt: LocalDate | null;
};

export interface PayrollDataPort {
  listSalaries(companyBin: Bin, year: number): Promise<Result<readonly SalaryRecord[], PortError>>;
}
