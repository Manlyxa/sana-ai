import type { Bin, Iin } from '../kernel/bin-iin';
import type { DocRef } from '../kernel/justification';
import type { LocalDate } from '../kernel/local-date';
import type { Money } from '../kernel/money';
import { err, ok, type Result } from '../kernel/result';
import type { Employee } from '../entities/employee';
import type { Invoice, InvoiceStatus } from '../entities/invoice';

/**
 * BusinessEvent — атом теневого регистра (P8). Всё остальное — проекции.
 * События неизменяемы и только добавляются.
 */

export type SourceSystem =
  | 'ИС_ЭСФ'
  | 'КНП' // кабинет налогоплательщика
  | 'БАНК'
  | 'ОФД'
  | 'ЕСУТД'
  | '1С'
  | 'РУЧНОЙ_ВВОД'
  | 'SANA';

export type BankTransactionPayload = {
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly amount: Money;
  readonly counterpartyBin: Bin | null;
  readonly counterpartyName: string | null;
  readonly purposeText: string;
  /** Код назначения платежа. */
  readonly knp: string | null;
};

export type EsfStatusChangedPayload = {
  readonly invoiceId: string;
  readonly from: InvoiceStatus;
  readonly to: InvoiceStatus;
};

/** Каталог типов событий MVP; расширяется по мере роста покрытия. */
export type EventPayloadMap = {
  ESF_ISSUED: { readonly invoice: Invoice };
  ESF_RECEIVED: { readonly invoice: Invoice };
  ESF_STATUS_CHANGED: EsfStatusChangedPayload;
  BANK_TRANSACTION: BankTransactionPayload;
  EMPLOYEE_HIRED: { readonly employee: Employee };
  EMPLOYEE_TERMINATED: { readonly iin: Iin; readonly terminatedAt: LocalDate };
};

export type BusinessEventType = keyof EventPayloadMap;

export type BusinessEvent<T extends BusinessEventType = BusinessEventType> = {
  readonly id: string;
  readonly companyId: string;
  /** Дата хозяйственной операции (календарная дата Алматы). */
  readonly occurredAt: LocalDate;
  readonly type: T;
  readonly payload: EventPayloadMap[T];
  readonly sourceSystem: SourceSystem;
  readonly sourceDocumentRef: DocRef | null;
  /** Дата попадания в теневой регистр. */
  readonly ingestedAt: LocalDate;
};

export type EventValidationError = { readonly message: string };

export function createBusinessEvent<T extends BusinessEventType>(
  input: BusinessEvent<T>,
): Result<BusinessEvent<T>, EventValidationError> {
  if (input.id.trim() === '') return err({ message: 'id события обязателен' });
  if (input.companyId.trim() === '') return err({ message: 'companyId обязателен' });
  return ok(Object.freeze({ ...input }));
}
