import {
  Bin,
  createCompany,
  LocalDate,
  unwrap,
  type Company,
  type RuleLawParams,
} from '@sana/domain';
import { buildRuleLawParams, createSeededStore } from '@sana/legal-params';
import {
  DEMO_IBAN,
  FixtureBankAdapter,
  FixtureCounterpartyRegistryAdapter,
  FixtureEnbekAdapter,
  FixtureEsfAdapter,
  FixtureTaxCabinetAdapter,
} from '@sana/adapters';
import type { CompliancePorts, ComplianceRepos } from '@sana/app';
import {
  CompanyRepository,
  createInMemoryDb,
  EventRepository,
  FindingRepository,
  LedgerRepository,
  type Db,
} from '@sana/db';

/**
 * Зависимости обработчиков worker'а. По умолчанию — fixtures + PGlite
 * (ноль креденшалов, §11); DATABASE_URL переключает на боевой Postgres.
 */

export type WorkerDeps = {
  readonly ports: CompliancePorts;
  readonly repos: ComplianceRepos;
  readonly company: Company;
  readonly accountIban: string;
  readonly law: RuleLawParams;
  readonly today: LocalDate;
};

export const DEMO_TODAY = unwrap(LocalDate.parse('2026-05-10'));

export async function createDemoDeps(db?: Db): Promise<WorkerDeps> {
  const database = db ?? (await createInMemoryDb());
  const company = unwrap(
    createCompany({
      id: 'demo-too',
      bin: unwrap(Bin.parse('120540000001')),
      name: 'ТОО «Демо Трейд»',
      oked: ['46739'],
      taxRegime: 'ОУР',
      vatStatus: { registered: true, since: unwrap(LocalDate.parse('2024-01-01')) },
      reportingStandard: 'НСФО',
      accountingPolicy: { vatCreditMethod: 'ПРОПОРЦИОНАЛЬНЫЙ' },
      employeeCount: 12,
    }),
  );
  await new CompanyRepository(database).upsert(company);
  return {
    ports: {
      esf: new FixtureEsfAdapter(),
      bank: new FixtureBankAdapter(),
      taxCabinet: new FixtureTaxCabinetAdapter(),
      enbek: new FixtureEnbekAdapter(),
      registry: new FixtureCounterpartyRegistryAdapter(),
    },
    repos: {
      events: new EventRepository(database),
      ledger: new LedgerRepository(database),
      findings: new FindingRepository(database),
    },
    company,
    accountIban: DEMO_IBAN,
    law: unwrap(buildRuleLawParams(createSeededStore(), DEMO_TODAY)),
    today: DEMO_TODAY,
  };
}
