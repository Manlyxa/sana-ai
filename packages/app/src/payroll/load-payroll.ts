import {
  createEmployee,
  err,
  ok,
  type Bin,
  type Employee,
  type Money,
  type Result,
} from '@sana/domain';
import type { EnbekPort, PayrollDataPort } from '@sana/ports';

/**
 * Сбор данных для зарплаты (§6): кадровые факты из ЕСУТД (EnbekPort)
 * соединяются по ИИН с ведомостью начислений (PayrollDataPort).
 * Сотрудник без договора или без даты рождения в ИИН — ошибка данных,
 * а не молчаливый пропуск.
 */

export type PayrollEmployeeRecord = {
  readonly employee: Employee;
  readonly position: string;
  /** Начислено по месяцам года (1–12); отсутствующий месяц = 0. */
  readonly grossByMonth: ReadonlyMap<number, Money>;
};

export type PayrollPorts = {
  readonly enbek: EnbekPort;
  readonly payroll: PayrollDataPort;
};

export type LoadPayrollError = { readonly message: string };

export async function loadPayrollRecords(
  ports: PayrollPorts,
  companyBin: Bin,
  year: number,
): Promise<Result<readonly PayrollEmployeeRecord[], LoadPayrollError>> {
  const [contracts, salaries] = await Promise.all([
    ports.enbek.listContracts(companyBin),
    ports.payroll.listSalaries(companyBin, year),
  ]);
  if (!contracts.ok) return err({ message: `ЕСУТД недоступен: ${contracts.error.message}` });
  if (!salaries.ok) return err({ message: `ведомость недоступна: ${salaries.error.message}` });

  const byIin = new Map(contracts.value.map((c) => [c.iin.value, c]));
  const records: PayrollEmployeeRecord[] = [];
  for (const salary of salaries.value) {
    const contract = byIin.get(salary.iin.value);
    if (contract === undefined) {
      return err({ message: `по ИИН ${salary.iin.value} нет трудового договора в ЕСУТД` });
    }
    const birthDate = salary.iin.birthDate;
    if (birthDate === null) {
      return err({ message: `ИИН ${salary.iin.value} не содержит даты рождения` });
    }
    const employee = createEmployee({
      iin: salary.iin,
      fullName: contract.fullName,
      birthDate,
      hiredAt: contract.hiredAt,
      terminatedAt: contract.terminatedAt,
      residency: 'РЕЗИДЕНТ_РК',
      pensionerByAge: false,
      disability: null,
      fullTimeStudent: false,
      ipnDeductionApplicationAt: salary.ipnDeductionApplicationAt,
      esutdRegisteredAt: contract.registeredAt,
    });
    if (!employee.ok) {
      return err({
        message: `сотрудник ${contract.fullName}: ${employee.error.map((e) => e.message).join('; ')}`,
      });
    }
    records.push({ employee: employee.value, position: salary.position, grossByMonth: salary.grossByMonth });
  }
  return ok(records);
}
