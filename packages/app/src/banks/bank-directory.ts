import { err, ok, type LocalDate, type Result } from '@sana/domain';
import type { BankPort } from '@sana/ports';

/**
 * Банковские счета (§13) — каркас без реальных API. «Подключить банк»
 * создаёт запись источника данных со статусом CONNECTED; выписки всех
 * подключённых источников участвуют в автопроводках (§2) наравне.
 * Реальная интеграция Kaspi/Halyk/BCC — следующая волна: она заменит
 * порт источника, не меняя этот каркас.
 */

export type BankCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly shortCode: string;
};

/** Банки, которые Sana умеет подключать (фикстурный каталог). */
export const BANK_CATALOG: readonly BankCatalogEntry[] = [
  { id: 'kaspi', name: 'Kaspi Bank', shortCode: 'K' },
  { id: 'halyk', name: 'Halyk Bank', shortCode: 'H' },
  { id: 'bcc', name: 'Банк ЦентрКредит', shortCode: 'BCC' },
  { id: 'freedom', name: 'Freedom Bank', shortCode: 'F' },
  { id: 'forte', name: 'ForteBank', shortCode: 'FB' },
  { id: 'jusan', name: 'Jusan Bank', shortCode: 'J' },
];

export type BankConnectionStatus = 'AVAILABLE' | 'CONNECTED';

export type BankConnection = {
  readonly id: string;
  readonly name: string;
  readonly shortCode: string;
  readonly status: BankConnectionStatus;
  readonly iban: string | null;
  readonly connectedAt: LocalDate | null;
};

export type BankSource = { readonly iban: string; readonly port: BankPort };

export type BankDirectoryError = { readonly message: string };

/** Порт «пустой выписки» для только что подключённого банка-фикстуры. */
export function emptyBankPort(): BankPort {
  return {
    getStatement: async () => ok([]),
  };
}

export class BankDirectory {
  private readonly connections = new Map<string, { conn: BankConnection; port: BankPort | null }>();

  constructor(
    catalog: readonly BankCatalogEntry[],
    preconnected: { readonly id: string; readonly iban: string; readonly port: BankPort; readonly at: LocalDate },
  ) {
    for (const entry of catalog) {
      this.connections.set(entry.id, {
        conn: { ...entry, status: 'AVAILABLE', iban: null, connectedAt: null },
        port: null,
      });
    }
    const first = this.connections.get(preconnected.id);
    if (first === undefined) {
      throw new Error(`банк «${preconnected.id}» отсутствует в каталоге`);
    }
    this.connections.set(preconnected.id, {
      conn: { ...first.conn, status: 'CONNECTED', iban: preconnected.iban, connectedAt: preconnected.at },
      port: preconnected.port,
    });
  }

  list(): readonly BankConnection[] {
    return [...this.connections.values()].map((c) => c.conn);
  }

  /** «Подключить банк»: запись источника со статусом CONNECTED. */
  connect(
    bankId: string,
    args: { readonly iban: string; readonly port: BankPort; readonly at: LocalDate },
  ): Result<BankConnection, BankDirectoryError> {
    const existing = this.connections.get(bankId);
    if (existing === undefined) {
      return err({ message: `банк «${bankId}» не найден в каталоге` });
    }
    if (existing.conn.status === 'CONNECTED') {
      return err({ message: `${existing.conn.name} уже подключён` });
    }
    const connected: BankConnection = {
      ...existing.conn,
      status: 'CONNECTED',
      iban: args.iban,
      connectedAt: args.at,
    };
    this.connections.set(bankId, { conn: connected, port: args.port });
    return ok(connected);
  }

  /** Источники выписок для автопроводок (§2). */
  connectedSources(): readonly BankSource[] {
    return [...this.connections.values()]
      .filter((c) => c.conn.status === 'CONNECTED' && c.port !== null && c.conn.iban !== null)
      .map((c) => ({ iban: c.conn.iban!, port: c.port! }));
  }
}
