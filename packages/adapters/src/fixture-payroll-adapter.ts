import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { err, Iin, LocalDate, Money, ok, type Bin, type Result } from '@sana/domain';
import type { PayrollDataPort, PortError, SalaryRecord } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';

const fileSchema = z.object({
  year: z.number().int(),
  salaries: z.array(
    z.object({
      iin: z.string(),
      position: z.string(),
      ipnDeductionApplicationAt: z.string().nullable(),
      /** Ключи «01»–«12», значения — начислено в тенге (целые). */
      grossByMonth: z.record(z.string(), z.number().int().nonnegative()),
    }),
  ),
});

/** Fixture-адаптер ведомости начислений (payroll/salaries.json). */
export class FixturePayrollAdapter implements PayrollDataPort {
  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  async listSalaries(
    _companyBin: Bin,
    year: number,
  ): Promise<Result<readonly SalaryRecord[], PortError>> {
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(
        JSON.parse(fs.readFileSync(path.join(this.fixturesRoot, 'payroll', 'salaries.json'), 'utf8')),
      );
    } catch (e) {
      return err({ kind: 'PARSE', message: `payroll/salaries.json: ${String(e)}` });
    }
    if (parsed.year !== year) {
      return err({ kind: 'NOT_FOUND', message: `ведомость за ${year} год отсутствует (есть ${parsed.year})` });
    }
    const records: SalaryRecord[] = [];
    for (const s of parsed.salaries) {
      const iin = Iin.parse(s.iin);
      if (!iin.ok) return err({ kind: 'PARSE', message: `ИИН ${s.iin}: ${iin.error}` });
      const application =
        s.ipnDeductionApplicationAt === null ? ok(null) : LocalDate.parse(s.ipnDeductionApplicationAt);
      if (!application.ok) {
        return err({ kind: 'PARSE', message: `дата заявления на вычет (${s.iin}): ${application.error}` });
      }
      const grossByMonth = new Map<number, Money>();
      for (const [key, tenge] of Object.entries(s.grossByMonth)) {
        const month = Number(key);
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          return err({ kind: 'PARSE', message: `месяц «${key}» вне диапазона 01–12 (${s.iin})` });
        }
        grossByMonth.set(month, Money.ofMajor(tenge));
      }
      records.push({
        iin: iin.value,
        position: s.position,
        grossByMonth,
        ipnDeductionApplicationAt: application.value,
      });
    }
    return ok(records);
  }
}
