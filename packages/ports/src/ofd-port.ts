import type { Bin, LocalDate, Money, Result } from '@sana/domain';
import type { DateRange, PortError } from './common';

/** Фискальный чек от оператора фискальных данных. */
export type FiscalReceipt = {
  readonly id: string;
  readonly kkmRegistrationNumber: string;
  readonly issuedAt: LocalDate;
  readonly total: Money;
  readonly vatAmount: Money;
};

export interface OfdPort {
  listReceipts(bin: Bin, range: DateRange): Promise<Result<readonly FiscalReceipt[], PortError>>;
}
