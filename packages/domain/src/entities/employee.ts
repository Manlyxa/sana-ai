import type { Iin } from '../kernel/bin-iin';
import type { LocalDate } from '../kernel/local-date';
import { err, ok, type Result } from '../kernel/result';
import { invalid, type ValidationError } from './validation';

/**
 * Работник. Поля статуса определяют освобождения в зарплатном движке
 * (фаза 3): пенсионеры, инвалидность, студенты, нерезиденты, ЕАЭС.
 */

export type DisabilityGroup = 'I' | 'II' | 'III';

export type Residency = 'РЕЗИДЕНТ_РК' | 'ЕАЭС' | 'ИНОСТРАНЕЦ';

export type Employee = {
  readonly iin: Iin;
  readonly fullName: string;
  readonly birthDate: LocalDate;
  readonly hiredAt: LocalDate;
  readonly terminatedAt: LocalDate | null;
  readonly residency: Residency;
  readonly pensionerByAge: boolean;
  readonly disability: { readonly group: DisabilityGroup; readonly indefinite: boolean } | null;
  readonly fullTimeStudent: boolean;
  /** Дата письменного заявления на стандартный вычет 30 МРП; null — заявления нет. */
  readonly ipnDeductionApplicationAt: LocalDate | null;
  /** Дата регистрации трудового договора в ЕСУТД; null — не зарегистрирован. */
  readonly esutdRegisteredAt: LocalDate | null;
};

export function createEmployee(input: Employee): Result<Employee, ValidationError[]> {
  const errors: ValidationError[] = [];
  if (input.fullName.trim() === '') errors.push(invalid('fullName', 'ФИО обязательно'));
  const encoded = input.iin.birthDate;
  if (encoded !== null && !encoded.equals(input.birthDate)) {
    errors.push(
      invalid(
        'birthDate',
        `дата рождения ${input.birthDate.toISO()} не совпадает с закодированной в ИИН ${encoded.toISO()}`,
      ),
    );
  }
  if (input.terminatedAt !== null && input.terminatedAt.isBefore(input.hiredAt)) {
    errors.push(invalid('terminatedAt', 'дата увольнения раньше даты приёма'));
  }
  if (errors.length > 0) return err(errors);
  return ok({ ...input });
}

/** Работает ли сотрудник на данную дату. */
export function isActiveOn(employee: Employee, date: LocalDate): boolean {
  if (date.isBefore(employee.hiredAt)) return false;
  return employee.terminatedAt === null || !date.isAfter(employee.terminatedAt);
}
