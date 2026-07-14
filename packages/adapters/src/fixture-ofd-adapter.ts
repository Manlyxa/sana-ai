import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { err, LocalDate, ok, unwrap, type Bin, type Result } from '@sana/domain';
import type { DateRange, FiscalReceipt, OfdPort, PortError } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';
import { parseDecimalTenge } from './parse';

const fileSchema = z.object({
  receipts: z.array(
    z.object({
      id: z.string(),
      kkmRegistrationNumber: z.string(),
      issuedAt: z.string(),
      total: z.string(),
      vatAmount: z.string(),
    }),
  ),
});

/** Fixture-адаптер ОФД. */
export class FixtureOfdAdapter implements OfdPort {
  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  async listReceipts(_bin: Bin, range: DateRange): Promise<Result<readonly FiscalReceipt[], PortError>> {
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(
        JSON.parse(fs.readFileSync(path.join(this.fixturesRoot, 'ofd', 'receipts.json'), 'utf8')),
      );
    } catch (e) {
      return err({ kind: 'PARSE', message: `ofd/receipts.json: ${String(e)}` });
    }
    const receipts: FiscalReceipt[] = [];
    for (const r of parsed.receipts) {
      const total = parseDecimalTenge(r.total);
      const vat = parseDecimalTenge(r.vatAmount);
      if (!total.ok || !vat.ok) return err({ kind: 'PARSE', message: `чек ${r.id}: сумма` });
      const issuedAt = unwrap(LocalDate.parse(r.issuedAt));
      if (!issuedAt.isWithin(range.from, range.to)) continue;
      receipts.push({
        id: r.id,
        kkmRegistrationNumber: r.kkmRegistrationNumber,
        issuedAt,
        total: total.value,
        vatAmount: vat.value,
      });
    }
    return ok(receipts);
  }
}
