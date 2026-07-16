import type { Bin, Iin, LocalDate, Result } from '@sana/domain';
import type { PortError } from './common';

/** Трудовой договор в ЕСУТД. */
export type EsutdContract = {
  readonly contractNumber: string;
  readonly iin: Iin;
  readonly fullName: string;
  readonly hiredAt: LocalDate;
  /** null — договор не зарегистрирован (нарушение ТК РК). */
  readonly registeredAt: LocalDate | null;
  readonly terminatedAt: LocalDate | null;
};

export interface EnbekPort {
  listContracts(companyBin: Bin): Promise<Result<readonly EsutdContract[], PortError>>;
}
