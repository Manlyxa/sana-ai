import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { err, Iin, LocalDate, ok, type Bin, type Result } from '@sana/domain';
import type { EnbekPort, EsutdContract, PortError } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';

const contractsSchema = z.object({
  contracts: z.array(
    z.object({
      contractNumber: z.string(),
      iin: z.string(),
      fullName: z.string(),
      hiredAt: z.string(),
      registeredAt: z.string().nullable(),
      terminatedAt: z.string().nullable(),
    }),
  ),
});

/** Fixture-адаптер ЕСУТД (enbek.kz). */
export class FixtureEnbekAdapter implements EnbekPort {
  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  async listContracts(_companyBin: Bin): Promise<Result<readonly EsutdContract[], PortError>> {
    let parsed: z.infer<typeof contractsSchema>;
    try {
      parsed = contractsSchema.parse(
        JSON.parse(fs.readFileSync(path.join(this.fixturesRoot, 'enbek', 'contracts.json'), 'utf8')),
      );
    } catch (e) {
      return err({ kind: 'PARSE', message: `enbek/contracts.json: ${String(e)}` });
    }
    const contracts: EsutdContract[] = [];
    for (const c of parsed.contracts) {
      const iin = Iin.parse(c.iin);
      const hiredAt = LocalDate.parse(c.hiredAt);
      if (!iin.ok || !hiredAt.ok) {
        return err({ kind: 'PARSE', message: `договор ${c.contractNumber}: ИИН/дата` });
      }
      const registeredAt = c.registeredAt === null ? ok(null) : LocalDate.parse(c.registeredAt);
      const terminatedAt = c.terminatedAt === null ? ok(null) : LocalDate.parse(c.terminatedAt);
      if (!registeredAt.ok || !terminatedAt.ok) {
        return err({ kind: 'PARSE', message: `договор ${c.contractNumber}: даты регистрации` });
      }
      contracts.push({
        contractNumber: c.contractNumber,
        iin: iin.value,
        fullName: c.fullName,
        hiredAt: hiredAt.value,
        registeredAt: registeredAt.value,
        terminatedAt: terminatedAt.value,
      });
    }
    return ok(contracts);
  }
}
