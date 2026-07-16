import type { Bin, Counterparty, Result } from '@sana/domain';
import type { PortError } from './common';

/** Реестры для проверки контрагента: БИН, статус НДС, лжепредприятие/e-Tamga. */
export interface CounterpartyRegistryPort {
  lookup(bin: Bin): Promise<Result<Counterparty, PortError>>;
}
