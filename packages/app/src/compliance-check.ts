import {
  err,
  evaluateRules,
  InMemoryBusinessEventStore,
  LocalDate,
  ok,
  projectJournal,
  projectTaxRegisters,
  type Company,
  type CompanyContext,
  type Counterparty,
  type Finding,
  type JournalEntry,
  type Result,
  type RuleLawParams,
  type TaxRegisterEntry,
} from '@sana/domain';
import type {
  BankPort,
  CounterpartyRegistryPort,
  EnbekPort,
  EsfPort,
  PortError,
  TaxCabinetPort,
} from '@sana/ports';
import { employeeFromContract, eventsFromBankLines, eventsFromInvoices } from './ingest';

/** Порты, необходимые комплаенс-проверке. */
export type CompliancePorts = {
  readonly esf: EsfPort;
  readonly bank: BankPort;
  readonly taxCabinet: TaxCabinetPort;
  readonly enbek: EnbekPort;
  readonly registry: CounterpartyRegistryPort;
};

export type ComplianceCheckInput = {
  readonly company: Company;
  readonly accountIban: string;
  readonly law: RuleLawParams;
  readonly asOf: LocalDate;
};

export type ComplianceCheckResult = {
  readonly context: CompanyContext;
  readonly eventStore: InMemoryBusinessEventStore;
  readonly journal: readonly JournalEntry[];
  readonly taxRegisters: readonly TaxRegisterEntry[];
  readonly findings: readonly Finding[];
};

/**
 * Сквозной сценарий MVP: порты → теневой регистр → проекции → правила.
 * Работает целиком на фикстурах — без единого внешнего креденшала (P5).
 */
export async function runComplianceCheck(
  ports: CompliancePorts,
  input: ComplianceCheckInput,
): Promise<Result<ComplianceCheckResult, PortError>> {
  const { company, law, asOf } = input;
  // Горизонт сбора: прошлый + текущий год (правила смотрят назад не дальше).
  const range = { from: LocalDate.of(asOf.year - 1, 1, 1), to: asOf };

  // 1. Сбор фактов через порты
  const invoices = await ports.esf.listInvoices(company.bin, range);
  if (!invoices.ok) return invoices;
  const bankLines = await ports.bank.getStatement(input.accountIban, range);
  if (!bankLines.ok) return bankLines;
  const obligations = await ports.taxCabinet.listObligations(company.bin);
  if (!obligations.ok) return obligations;
  const notices = await ports.taxCabinet.listNotices(company.bin);
  if (!notices.ok) return notices;
  const contracts = await ports.enbek.listContracts(company.bin);
  if (!contracts.ok) return contracts;

  // 2. Контрагенты по всем встреченным БИН
  const bins = new Map(invoices.value.map((inv) => [inv.counterpartyBin.value, inv.counterpartyBin]));
  const counterparties: Counterparty[] = [];
  for (const bin of bins.values()) {
    const cp = await ports.registry.lookup(bin);
    if (!cp.ok) return cp;
    counterparties.push(cp.value);
  }

  // 3. Теневой регистр: события + независимые проекции (P7, P8)
  const eventStore = new InMemoryBusinessEventStore();
  const appended = eventStore.appendAll([
    ...eventsFromInvoices(company.id, invoices.value, asOf),
    ...eventsFromBankLines(company.id, bankLines.value, asOf),
  ]);
  if (!appended.ok) {
    return err({ kind: 'VALIDATION', message: `дубликат события: ${appended.error.id}` });
  }
  const journal = projectJournal(eventStore.all());
  if (!journal.ok) {
    return err({ kind: 'VALIDATION', message: `проекция журнала: ${journal.error.reason.message}` });
  }
  const taxRegisters = projectTaxRegisters(eventStore.all());

  // 4. Контекст компании и прогон правил
  const employees = contracts.value
    .map(employeeFromContract)
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const context: CompanyContext = {
    company,
    counterparties,
    invoices: invoices.value,
    obligations: obligations.value.map((o) => ({ ...o, companyId: company.id })),
    employees,
    events: eventStore.all(),
    taxNotices: notices.value,
    advances: [],
    nonResidentVatPayments: [],
    externalPayroll: [],
    finalSettlements: [],
    virtualWarehouse: [],
    law,
  };

  const findings = evaluateRules(context, asOf);
  return ok({ context, eventStore, journal: journal.value, taxRegisters, findings });
}
