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
  AnthropicLlmAdapter,
  DEMO_IBAN,
  FixtureBankAdapter,
  FixtureCounterpartyRegistryAdapter,
  FixtureEnbekAdapter,
  FixtureEsfAdapter,
  FixtureOcrAdapter,
  FixturePayrollAdapter,
  FixtureTaxCabinetAdapter,
  MockSignatureProvider,
} from '@sana/adapters';
import type { CompliancePorts } from '@sana/app';
import type { DocumentOcrPort, LlmPort, PayrollDataPort, SignaturePort } from '@sana/ports';
import {
  CompanyRepository,
  createInMemoryDb,
  EventRepository,
  FindingRepository,
  LedgerEntryRepository,
  LedgerRepository,
  type Db,
} from '@sana/db';

/**
 * Контекст API. По умолчанию — fixtures + встроенный Postgres (PGlite):
 * `pnpm dev` поднимает стек без единого внешнего креденшала (§11).
 * Боевой Postgres подключается через DATABASE_URL (createPostgresDb).
 */

export type ApiContext = {
  readonly db: Db;
  readonly repos: {
    readonly companies: CompanyRepository;
    readonly events: EventRepository;
    readonly findings: FindingRepository;
    readonly ledger: LedgerRepository;
    /** Персистентность главной книги (двойная запись) — переживает рестарт. */
    readonly ledgerEntries: LedgerEntryRepository;
  };
  readonly ports: CompliancePorts;
  /** Источник ведомости начислений (§6) — отдельно от комплаенс-портов. */
  readonly payrollData: PayrollDataPort;
  /** Распознавание первички (§8) — фикстурный OCR. */
  readonly ocr: DocumentOcrPort;
  /**
   * LLM для агентов и AI-классификации проводок. null, если нет
   * ANTHROPIC_API_KEY: движок и агенты работают на детерминированных
   * эвристиках/базе знаний (LLM никогда не считает деньги, P1).
   */
  readonly llm: LlmPort | null;
  readonly signatures: SignaturePort;
  readonly company: Company;
  readonly accountIban: string;
  readonly law: RuleLawParams;
  readonly today: LocalDate;
};

export const DEMO_TODAY = unwrap(LocalDate.parse('2026-05-10'));

export function demoCompany(): Company {
  return unwrap(
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
}

export type CreateDemoContextOptions = {
  /** Явный LLM (например MockLlmAdapter в тестах). undefined → авто по env. */
  readonly llm?: LlmPort | null;
};

export async function createDemoContext(
  db?: Db,
  options: CreateDemoContextOptions = {},
): Promise<ApiContext> {
  const database = db ?? (await createInMemoryDb());
  const company = demoCompany();
  const repos = {
    companies: new CompanyRepository(database),
    events: new EventRepository(database),
    findings: new FindingRepository(database),
    ledger: new LedgerRepository(database),
    ledgerEntries: new LedgerEntryRepository(database),
  };
  await repos.companies.upsert(company);
  return {
    db: database,
    repos,
    ports: {
      esf: new FixtureEsfAdapter(),
      bank: new FixtureBankAdapter(),
      taxCabinet: new FixtureTaxCabinetAdapter(),
      enbek: new FixtureEnbekAdapter(),
      registry: new FixtureCounterpartyRegistryAdapter(),
    },
    payrollData: new FixturePayrollAdapter(),
    ocr: new FixtureOcrAdapter(),
    // 'llm' in options различает «не передан» (авто по env) и явный null/мок.
    llm: 'llm' in options ? (options.llm ?? null) : defaultLlm(),
    signatures: new MockSignatureProvider(),
    company,
    accountIban: DEMO_IBAN,
    law: unwrap(buildRuleLawParams(createSeededStore(), DEMO_TODAY)),
    today: DEMO_TODAY,
  };
}

/**
 * Боевой LLM только при наличии ANTHROPIC_API_KEY. Без ключа — null:
 * агенты и AI-классификатор откатываются на детерминированную логику,
 * а тесты остаются герметичными (без внешних вызовов).
 */
function defaultLlm(): LlmPort | null {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (key === undefined || key.trim() === '') return null;
  return new AnthropicLlmAdapter();
}
