import type { Employee } from '../entities/employee';

/**
 * Матрица освобождений от платежей по статусу работника.
 *
 * ДОПУЩЕНИЯ, ТРЕБУЮЩИЕ ПОДТВЕРЖДЕНИЯ ЭКСПЕРТОМ (§10, TODO_VERIFY):
 * - ИНОСТРАНЕЦ (нерезидент без ВНЖ): не участвует в ОПВ/ВОСМС/СО/ООСМС/ОПВР,
 *   ИПН — без вычетов.
 * - ЕАЭС: приравнен к резиденту по всем платежам (договор о ЕАЭС).
 * - ВОСМС/ООСМС: освобождены пенсионеры, инвалиды всех групп, студенты-очники
 *   (ВОСМС); для ООСМС — пенсионеры и инвалиды.
 * - СО: освобождены пенсионеры по возрасту.
 */

export function isOpvExempt(e: Employee): boolean {
  if (e.residency === 'ИНОСТРАНЕЦ') return true;
  if (e.pensionerByAge) return true;
  // Инвалидность I–II групп, установленная бессрочно (§6 п.1).
  return e.disability !== null && e.disability.indefinite && e.disability.group !== 'III';
}

export function isVosmsExempt(e: Employee): boolean {
  if (e.residency === 'ИНОСТРАНЕЦ') return true;
  return e.pensionerByAge || e.fullTimeStudent || e.disability !== null;
}

export function isSoExempt(e: Employee): boolean {
  return e.residency === 'ИНОСТРАНЕЦ' || e.pensionerByAge;
}

export function isOosmsExempt(e: Employee): boolean {
  if (e.residency === 'ИНОСТРАНЕЦ') return true;
  return e.pensionerByAge || e.disability !== null;
}

export function isOpvrExempt(e: Employee): boolean {
  return e.residency === 'ИНОСТРАНЕЦ' || e.pensionerByAge;
}

/** Право на вычеты по ИПН (стандартный 30 МРП, дополнительный 882 МРП). */
export function isEligibleForIpnDeductions(e: Employee): boolean {
  return e.residency !== 'ИНОСТРАНЕЦ';
}
