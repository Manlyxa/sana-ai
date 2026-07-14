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
