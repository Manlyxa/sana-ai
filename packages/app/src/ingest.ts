import {
  createBusinessEvent,
  createEmployee,
  unwrap,
  type BusinessEvent,
  type Employee,
  type Invoice,
  type LocalDate,
} from '@sana/domain';
import type { BankStatementLine, EsutdContract } from '@sana/ports';

/**
 * Нормализация входящих фактов в события теневого регистра (P8).
 * Чистые функции: порты уже отдали данные, здесь только преобразование.
 */

export function eventsFromInvoices(
  companyId: string,
  invoices: readonly Invoice[],
  ingestedAt: LocalDate,
): readonly BusinessEvent[] {
  return invoices
    .filter((inv) => inv.status !== 'ЧЕРНОВИК')
    .map((inv) =>
      unwrap(
        createBusinessEvent({
          id: `evt-esf-${inv.id}`,
          companyId,
          occurredAt: inv.turnoverDate,
          type: inv.direction === 'OUT' ? ('ESF_ISSUED' as const) : ('ESF_RECEIVED' as const),
          payload: { invoice: inv },
          sourceSystem: 'ИС_ЭСФ',
          sourceDocumentRef: { system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: inv.number },
          ingestedAt,
        }),
      ),
    );
}

export function eventsFromBankLines(
  companyId: string,
  lines: readonly BankStatementLine[],
  ingestedAt: LocalDate,
): readonly BusinessEvent[] {
  return lines.map((line) =>
    unwrap(
      createBusinessEvent({
        id: `evt-bank-${line.id}`,
        companyId,
        occurredAt: line.bookingDate,
        type: 'BANK_TRANSACTION',
        payload: {
          direction: line.direction,
          amount: line.amount,
          counterpartyBin: line.counterpartyBin,
          counterpartyName: line.counterpartyName,
          purposeText: line.purpose,
          knp: line.knp,
        },
        sourceSystem: 'БАНК',
        sourceDocumentRef: { system: 'БАНК', documentType: 'выписка', documentId: line.id },
        ingestedAt,
      }),
    ),
  );
}

/** Работник из договора ЕСУТД; дата рождения — из ИИН. */
export function employeeFromContract(contract: EsutdContract): Employee | null {
  const birthDate = contract.iin.birthDate;
  if (birthDate === null) return null;
  const employee = createEmployee({
    iin: contract.iin,
    fullName: contract.fullName,
    birthDate,
    hiredAt: contract.hiredAt,
    terminatedAt: contract.terminatedAt,
    residency: 'РЕЗИДЕНТ_РК',
    pensionerByAge: false,
    disability: null,
    fullTimeStudent: false,
    ipnDeductionApplicationAt: null,
    esutdRegisteredAt: contract.registeredAt,
  });
  return employee.ok ? employee.value : null;
}
