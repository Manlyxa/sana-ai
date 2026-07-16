import { Bin, Iin } from '../kernel/bin-iin';
import { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import { Rate } from '../kernel/rate';
import { unwrap } from '../kernel/result';
import type { Company } from '../entities/company';
import type { Counterparty } from '../entities/counterparty';
import type { Employee } from '../entities/employee';
import { createInvoice, type Invoice } from '../entities/invoice';
import { createBusinessEvent, type BusinessEvent, type BusinessEventType } from '../ledger/business-event';

/**
 * Детерминированные тестовые данные. Номера БИН/ИИН сгенерированы по
 * официальному алгоритму контрольного разряда; реальным лицам не принадлежат.
 */

export const TEST_BIN = unwrap(Bin.parse('120540000001'));
export const TEST_BIN_2 = unwrap(Bin.parse('201140000007'));
export const TEST_IIN_1990 = unwrap(Iin.parse('900515300008'));
export const TEST_IIN_1970 = unwrap(Iin.parse('700301300002'));

export const D = (iso: string): LocalDate => unwrap(LocalDate.parse(iso));

export function testCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co-1',
    bin: TEST_BIN,
    name: 'ТОО «Тестовая Компания»',
    oked: ['62010'],
    taxRegime: 'ОУР',
    vatStatus: { registered: true, since: D('2024-01-01') },
    reportingStandard: 'НСФО',
    accountingPolicy: { vatCreditMethod: 'ПРОПОРЦИОНАЛЬНЫЙ' },
    employeeCount: 12,
    ...overrides,
  };
}

export function testCounterparty(overrides: Partial<Counterparty> = {}): Counterparty {
  return {
    bin: TEST_BIN_2,
    name: 'ТОО «Поставщик»',
    vatPayer: true,
    taxRegime: 'ОУР',
    riskScore: 5,
    riskFlags: [],
    lastCheckedAt: D('2026-03-01'),
    ...overrides,
  };
}

export function testEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    iin: TEST_IIN_1990,
    fullName: 'Тестов Тест Тестович',
    birthDate: D('1990-05-15'),
    hiredAt: D('2024-02-01'),
    terminatedAt: null,
    residency: 'РЕЗИДЕНТ_РК',
    pensionerByAge: false,
    disability: null,
    fullTimeStudent: false,
    ipnDeductionApplicationAt: D('2024-02-01'),
    esutdRegisteredAt: D('2024-02-01'),
    ...overrides,
  };
}

/** ЭСФ на 1 000 000 ₸ без НДС + 16% НДС, одна строка. */
export function testInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const net = Money.ofMajor(1_000_000);
  const vat = net.percent(Rate.percent(16));
  return unwrap(
    createInvoice({
      id: 'inv-1',
      number: 'ESF-2026-000123',
      direction: 'OUT',
      turnoverDate: D('2026-02-10'),
      issueDate: D('2026-02-12'),
      counterpartyBin: TEST_BIN_2,
      counterpartyName: 'ТОО «Покупатель»',
      lines: [
        {
          description: 'Консультационные услуги',
          total: net,
          vatRate: Rate.percent(16),
          vatAmount: vat,
        },
      ],
      totalExVat: net,
      vatAmount: vat,
      status: 'ВЫСТАВЛЕН',
      confirmedByRecipientAt: null,
      vatCreditNoticeSentAt: null,
      ...overrides,
    }),
  );
}

export function testEvent<T extends BusinessEventType>(
  type: T,
  payload: BusinessEvent<T>['payload'],
  overrides: Partial<Omit<BusinessEvent<T>, 'type' | 'payload'>> = {},
): BusinessEvent<T> {
  return unwrap(
    createBusinessEvent<T>({
      id: `evt-${type.toLowerCase()}-1`,
      companyId: 'co-1',
      occurredAt: D('2026-02-10'),
      type,
      payload,
      sourceSystem: 'ИС_ЭСФ',
      sourceDocumentRef: { system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: 'ESF-2026-000123' },
      ingestedAt: D('2026-02-11'),
      ...overrides,
    }),
  );
}

// ---------------------------------------------------------------------------
// Параметры законодательства 2026 для тестов (значения §5 спецификации)
// ---------------------------------------------------------------------------

import type { PayrollLawParams } from '../payroll/params';

export function payrollParams2026(): PayrollLawParams {
  return {
    version: 'legal-params@2026-01-01',
    mrp: Money.ofMajor(4_325),
    mzp: Money.ofMajor(85_000),
    opv: { rate: Rate.percent(10), capMzp: 50 },
    vosms: { rate: Rate.percent(2), capMzp: 20 },
    opvr: { rate: Rate.percent('3.5'), capMzp: 50, exemptIfBornBefore: D('1975-01-01') },
    so: { rate: Rate.percent(5), floorMzp: 1, capMzp: 7 },
    oosms: { rate: Rate.percent(3), capMzp: 40 },
    sn: { rate: Rate.percent(6) },
    ipn: {
      bracket1Rate: Rate.percent(10),
      bracket1CeilingMrp: 8_500,
      bracket2Rate: Rate.percent(15),
      standardDeductionMrpPerMonth: 30,
      standardDeductionMrpAnnualMax: 360,
      additionalDeductionDisabilityMrpAnnual: 882,
    },
  };
}

// ---------------------------------------------------------------------------
// Контекст компании для тестов правил (§7): чистые данные — ничего не срабатывает
// ---------------------------------------------------------------------------

import type { CompanyContext, RuleLawParams } from '../rules/context';

export function ruleLawParams2026(): RuleLawParams {
  return {
    version: 'legal-params@2026-01-01',
    mrp: Money.ofMajor(4_325),
    mzp: Money.ofMajor(85_000),
    vatRegistrationThresholdMrp: 10_000,
    vatRegistrationApplicationWorkingDays: 5,
    esfIssueDeadlineCalendarDays: 15,
    esfNonresidentDeadlineCalendarDays: 5,
    fno300Closes: { monthsAfterPeriodEnd: 2, dayOfMonth: 15 },
    ipnBracket1Rate: Rate.percent(10),
    kpnRate: Rate.percent(20),
    opvrExemptIfBornBefore: D('1975-01-01'),
    ipnStandardDeductionMrpPerMonth: 30,
    esutdRegistrationWorkingDays: 5,
    noticeResponseWorkingDays: 30,
    fineEsfNonIssueMrp: 40,
    fineFnoLateMrp: 30,
    fineEsutdMrp: 30,
    fineVatRegistrationMrp: 50,
    holidays: new Set<string>(),
  };
}

/** Контекст «здоровой» компании: ни одно правило не должно сработать. */
export function testRuleContext(overrides: Partial<CompanyContext> = {}): CompanyContext {
  return {
    company: testCompany(),
    counterparties: [testCounterparty()],
    invoices: [],
    obligations: [],
    employees: [],
    events: [],
    taxNotices: [],
    advances: [],
    nonResidentVatPayments: [],
    externalPayroll: [],
    finalSettlements: [],
    virtualWarehouse: [],
    law: ruleLawParams2026(),
    ...overrides,
  };
}
