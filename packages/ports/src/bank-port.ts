import type { Bin, LocalDate, Money, Result } from '@sana/domain';
import type { DateRange, PortError } from './common';

/** Нормализованная строка банковской выписки (CSV/MT940 — потом API банков). */
export type BankStatementLine = {
  readonly id: string;
  readonly accountIban: string;
  readonly bookingDate: LocalDate;
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly amount: Money;
  readonly counterpartyBin: Bin | null;
  readonly counterpartyName: string | null;
  /** Код назначения платежа. */
  readonly knp: string | null;
  readonly purpose: string;
};

export interface BankPort {
  getStatement(accountIban: string, range: DateRange): Promise<Result<readonly BankStatementLine[], PortError>>;
}
