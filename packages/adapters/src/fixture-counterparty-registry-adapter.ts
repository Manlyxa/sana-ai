import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  createCounterparty,
  err,
  LocalDate,
  ok,
  RISK_FLAGS,
  unwrap,
  type Bin,
  type Counterparty,
  type Result,
} from '@sana/domain';
import type { CounterpartyRegistryPort, PortError } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';

const entrySchema = z.object({
  name: z.string(),
  vatPayer: z.boolean(),
  taxRegime: z.enum(['ОУР', 'СНР_УПРОЩЁНКА', 'СНР_САМОЗАНЯТЫЙ', 'СНР_КФХ', 'НЕИЗВЕСТНО']),
  riskScore: z.number().int(),
  riskFlags: z.array(z.enum(RISK_FLAGS)),
  lastCheckedAt: z.string().nullable(),
});

const fileSchema = z.object({ counterparties: z.record(z.string(), entrySchema) });

/** Fixture-адаптер реестров проверки контрагентов (БИН, НДС, лжепредприятия). */
export class FixtureCounterpartyRegistryAdapter implements CounterpartyRegistryPort {
  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  async lookup(bin: Bin): Promise<Result<Counterparty, PortError>> {
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(
        JSON.parse(
          fs.readFileSync(path.join(this.fixturesRoot, 'registry', 'counterparties.json'), 'utf8'),
        ),
      );
    } catch (e) {
      return err({ kind: 'PARSE', message: `registry/counterparties.json: ${String(e)}` });
    }
    const entry = parsed.counterparties[bin.value];
    if (entry === undefined) {
      return err({ kind: 'NOT_FOUND', message: `БИН ${bin.value} не найден в реестре` });
    }
    const counterparty = createCounterparty({
      bin,
      name: entry.name,
      vatPayer: entry.vatPayer,
      taxRegime: entry.taxRegime,
      riskScore: entry.riskScore,
      riskFlags: entry.riskFlags,
      lastCheckedAt: entry.lastCheckedAt === null ? null : unwrap(LocalDate.parse(entry.lastCheckedAt)),
    });
    if (!counterparty.ok) {
      return err({ kind: 'VALIDATION', message: JSON.stringify(counterparty.error) });
    }
    return ok(counterparty.value);
  }
}
