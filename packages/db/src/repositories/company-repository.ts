import { eq } from 'drizzle-orm';
import {
  Bin,
  createCompany,
  err,
  LocalDate,
  ok,
  type Company,
  type Result,
  type TaxRegime,
  type ReportingStandard,
  type AccountingPolicy,
} from '@sana/domain';
import type { Db } from '../client';
import { companies } from '../schema';

export class CompanyRepository {
  constructor(private readonly db: Db) {}

  async upsert(company: Company): Promise<void> {
    const values = {
      id: company.id,
      bin: company.bin.value,
      name: company.name,
      oked: [...company.oked],
      taxRegime: company.taxRegime,
      vatRegistered: company.vatStatus.registered,
      vatSince: company.vatStatus.registered ? company.vatStatus.since.toISO() : null,
      reportingStandard: company.reportingStandard,
      accountingPolicy: company.accountingPolicy as unknown as Record<string, unknown>,
      employeeCount: company.employeeCount,
    };
    await this.db
      .insert(companies)
      .values(values)
      .onConflictDoUpdate({ target: companies.id, set: values });
  }

  async get(id: string): Promise<Result<Company, string> | null> {
    const rows = await this.db.select().from(companies).where(eq(companies.id, id));
    const row = rows[0];
    if (row === undefined) return null;
    const bin = Bin.parse(row.bin);
    if (!bin.ok) return err(`компания ${id}: БИН — ${bin.error.message}`);
    let vatSince: LocalDate | null = null;
    if (row.vatRegistered) {
      if (row.vatSince === null) return err(`компания ${id}: нет даты постановки на НДС`);
      const parsed = LocalDate.parse(row.vatSince);
      if (!parsed.ok) return err(`компания ${id}: дата НДС — ${parsed.error}`);
      vatSince = parsed.value;
    }
    const company = createCompany({
      id: row.id,
      bin: bin.value,
      name: row.name,
      oked: row.oked,
      taxRegime: row.taxRegime as TaxRegime,
      vatStatus: row.vatRegistered && vatSince !== null ? { registered: true, since: vatSince } : { registered: false },
      reportingStandard: row.reportingStandard as ReportingStandard,
      accountingPolicy: row.accountingPolicy as unknown as AccountingPolicy,
      employeeCount: row.employeeCount,
    });
    if (!company.ok) return err(`компания ${id}: ${JSON.stringify(company.error)}`);
    return ok(company.value);
  }
}
