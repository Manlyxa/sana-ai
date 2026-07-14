import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bin,
  createBusinessEvent,
  createCompany,
  createInvoice,
  createJustification,
  Iin,
  LocalDate,
  Money,
  Rate,
  unwrap,
  type BusinessEvent,
  type Company,
  type Finding,
  type Invoice,
} from '@sana/domain';
import { createInMemoryDb, type Db } from './client';
import { CompanyRepository } from './repositories/company-repository';
import { EventRepository } from './repositories/event-repository';
import { FindingRepository } from './repositories/finding-repository';
import { LedgerRepository } from './repositories/ledger-repository';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const BIN = unwrap(Bin.parse('120540000001'));
const IIN = unwrap(Iin.parse('900515300008'));

function company(): Company {
  return unwrap(
    createCompany({
      id: 'co-db-1',
      bin: BIN,
      name: 'ТОО «Демо Трейд»',
      oked: ['46739'],
      taxRegime: 'ОУР',
      vatStatus: { registered: true, since: D('2024-01-01') },
      reportingStandard: 'НСФО',
      accountingPolicy: { vatCreditMethod: 'ПРОПОРЦИОНАЛЬНЫЙ' },
      employeeCount: 12,
    }),
  );
}

function invoice(): Invoice {
  const net = Money.ofMajor(1_000_000);
  return unwrap(
    createInvoice({
      id: 'inv-db-1',
      number: 'ESF-DB-0001',
      direction: 'IN',
      turnoverDate: D('2026-02-10'),
      issueDate: D('2026-02-12'),
      counterpartyBin: BIN,
      counterpartyName: 'ТОО «Поставщик»',
      lines: [
        { description: 'Товар', quantity: '5', total: net, vatRate: Rate.percent(16), vatAmount: Money.ofMajor(160_000) },
      ],
      totalExVat: net,
      vatAmount: Money.ofMajor(160_000),
      status: 'ПОДТВЕРЖДЁН',
      confirmedByRecipientAt: D('2026-02-15'),
      vatCreditNoticeSentAt: null,
    }),
  );
}

function esfEvent(): BusinessEvent {
  return unwrap(
    createBusinessEvent({
      id: 'evt-db-esf-1',
      companyId: 'co-db-1',
      occurredAt: D('2026-02-10'),
      type: 'ESF_RECEIVED',
      payload: { invoice: invoice() },
      sourceSystem: 'ИС_ЭСФ',
      sourceDocumentRef: { system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: 'ESF-DB-0001' },
      ingestedAt: D('2026-02-11'),
    }),
  );
}

function bankEvent(): BusinessEvent {
  return unwrap(
    createBusinessEvent({
      id: 'evt-db-bank-1',
      companyId: 'co-db-1',
      occurredAt: D('2026-02-20'),
      type: 'BANK_TRANSACTION',
      payload: {
        direction: 'DEBIT',
        amount: Money.ofMajor(1_160_000),
        counterpartyBin: null,
        counterpartyName: null,
        purposeText: 'Оплата поставщику',
        knp: '710',
      },
      sourceSystem: 'БАНК',
      sourceDocumentRef: null,
      ingestedAt: D('2026-02-21'),
    }),
  );
}

function hireEvent(): BusinessEvent {
  return unwrap(
    createBusinessEvent({
      id: 'evt-db-hire-1',
      companyId: 'co-db-1',
      occurredAt: D('2026-03-02'),
      type: 'EMPLOYEE_HIRED',
      payload: {
        employee: {
          iin: IIN,
          fullName: 'Жумабаев Ерлан Кайратович',
          birthDate: D('1990-05-15'),
          hiredAt: D('2026-03-02'),
          terminatedAt: null,
          residency: 'РЕЗИДЕНТ_РК',
          pensionerByAge: false,
          disability: null,
          fullTimeStudent: false,
          ipnDeductionApplicationAt: null,
          esutdRegisteredAt: null,
        },
      },
      sourceSystem: 'ЕСУТД',
      sourceDocumentRef: null,
      ingestedAt: D('2026-03-03'),
    }),
  );
}

function finding(id: string, exposureTenge: number): Finding {
  return {
    id,
    ruleId: id.split(':')[0] as string,
    companyId: 'co-db-1',
    severity: 'CRITICAL',
    asOf: D('2026-05-10'),
    exposure: Money.ofMajor(exposureTenge),
    message: 'Вы теряете зачёт НДС, если не отправите извещение.',
    justification: unwrap(
      createJustification({
        norm: 'п. 8 ст. 480 НК РК',
        sourceDocuments: [{ system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: 'ESF-DB-0001' }],
        parameterVersion: 'legal-params@2026-05-10',
        explanation: 'Вы теряете зачёт НДС, если не отправите извещение.',
      }),
    ),
    remediation: { kind: 'SEND_VAT_CREDIT_NOTICE', description: 'Отправить извещение', autonomyLevel: 'A3' },
  };
}

let db: Db;

beforeAll(async () => {
  db = await createInMemoryDb();
  await new CompanyRepository(db).upsert(company());
});

describe('CompanyRepository', () => {
  it('round-trip компании через Postgres', async () => {
    const repo = new CompanyRepository(db);
    const loaded = unwrap((await repo.get('co-db-1'))!);
    expect(loaded.bin.equals(BIN)).toBe(true);
    expect(loaded.vatStatus).toEqual({ registered: true, since: D('2024-01-01') });
    expect(loaded.employeeCount).toBe(12);
    expect(await repo.get('нет')).toBeNull();
  });
});

describe('EventRepository (P8)', () => {
  it('append-only с сохранением семантики InMemory-хранилища', async () => {
    const repo = new EventRepository(db);
    expect((await repo.append(esfEvent())).ok).toBe(true);
    expect((await repo.append(bankEvent())).ok).toBe(true);
    expect((await repo.append(hireEvent())).ok).toBe(true);

    const dup = await repo.append(esfEvent());
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toEqual({ kind: 'DUPLICATE_ID', id: 'evt-db-esf-1' });
    expect(await repo.count('co-db-1')).toBe(3);
  });

  it('повторная загрузка тех же событий идемпотентна (appendAll)', async () => {
    const repo = new EventRepository(db);
    const r = unwrap(await repo.appendAll([esfEvent(), bankEvent(), hireEvent()]));
    expect(r).toBe(0); // все уже есть
    expect(await repo.count('co-db-1')).toBe(3);
  });

  it('round-trip: домен → jsonb → домен без потерь', async () => {
    const repo = new EventRepository(db);
    const events = unwrap(await repo.forCompany('co-db-1'));
    expect(events.map((e) => e.id)).toEqual(['evt-db-esf-1', 'evt-db-bank-1', 'evt-db-hire-1']);

    const esf = events[0] as BusinessEvent<'ESF_RECEIVED'>;
    expect(esf.payload.invoice.vatAmount.equals(Money.ofMajor(160_000))).toBe(true);
    expect(esf.payload.invoice.turnoverDate.equals(D('2026-02-10'))).toBe(true);
    expect(esf.payload.invoice.lines[0]?.vatRate.equals(Rate.percent(16))).toBe(true);
    expect(esf.payload.invoice.counterpartyBin.equals(BIN)).toBe(true);

    const bank = events[1] as BusinessEvent<'BANK_TRANSACTION'>;
    expect(bank.payload.amount.amount).toBe(116_000_000n);
    expect(bank.payload.counterpartyBin).toBeNull();

    const hire = events[2] as BusinessEvent<'EMPLOYEE_HIRED'>;
    expect(hire.payload.employee.iin.equals(IIN)).toBe(true);
    expect(hire.payload.employee.birthDate.equals(D('1990-05-15'))).toBe(true);
  });
});

describe('FindingRepository', () => {
  it('жизненный цикл: добавлена → удержана (firstDetectedAt не меняется) → решена → переоткрыта', async () => {
    const repo = new FindingRepository(db);
    const a = finding('VAT_CREDIT_NOTICE_MISSING:inv-db-1', 160_000);
    const b = finding('FILING_OVERDUE:ob-1', 129_750);

    // Прогон 1: обе новые
    const run1 = await repo.reconcileRun('co-db-1', [a, b], D('2026-05-10'));
    expect(run1).toEqual({ added: 2, retained: 0, resolved: 0 });

    // Прогон 2: a осталась (больше экспозиция), b решена
    const a2 = { ...a, exposure: Money.ofMajor(200_000), asOf: D('2026-05-11') };
    const run2 = await repo.reconcileRun('co-db-1', [a2], D('2026-05-11'));
    expect(run2).toEqual({ added: 0, retained: 1, resolved: 1 });

    const open = unwrap(await repo.listOpen('co-db-1'));
    expect(open).toHaveLength(1);
    expect(open[0]?.exposure.equals(Money.ofMajor(200_000))).toBe(true);

    // Прогон 3: b появилась снова — переоткрывается, а не дублируется
    const run3 = await repo.reconcileRun('co-db-1', [a2, b], D('2026-05-12'));
    expect(run3.resolved).toBe(0);
    const reopened = unwrap(await repo.listOpen('co-db-1'));
    expect(reopened).toHaveLength(2);
    // лента по убыванию тенге
    expect(reopened[0]?.exposure.compareTo(reopened[1]!.exposure)).toBeGreaterThan(0);

    // getOpen находит открытую, null для чужой
    expect((await repo.getOpen('VAT_CREDIT_NOTICE_MISSING:inv-db-1'))).not.toBeNull();
    expect(await repo.getOpen('нет-такой')).toBeNull();
  });
});

describe('LedgerRepository (P7)', () => {
  it('round-trip проводок и налоговых регистров; повторная запись — полная замена', async () => {
    const repo = new LedgerRepository(db);
    const je = {
      id: 'je-evt-db-esf-1',
      companyId: 'co-db-1',
      businessEventId: 'evt-db-esf-1',
      date: D('2026-02-10'),
      memo: 'Приобретение по ЭСФ',
      lines: [
        { account: '1330', side: 'DEBIT' as const, amount: Money.ofMajor(1_000_000) },
        { account: '1420', side: 'DEBIT' as const, amount: Money.ofMajor(160_000) },
        { account: '3310', side: 'CREDIT' as const, amount: Money.ofMajor(1_160_000) },
      ],
    };
    await repo.replaceJournal('co-db-1', [je]);
    await repo.replaceJournal('co-db-1', [je]); // идемпотентная пересборка
    const journal = unwrap(await repo.listJournal('co-db-1'));
    expect(journal).toHaveLength(1);
    expect(journal[0]?.lines[2]?.amount.equals(Money.ofMajor(1_160_000))).toBe(true);

    const tr = {
      id: 'tr-evt-db-esf-1-ndszachet',
      companyId: 'co-db-1',
      businessEventId: 'evt-db-esf-1',
      register: 'НДС_ЗАЧЁТ' as const,
      period: unwrap((await import('@sana/domain')).TaxPeriod.parse('2026-Q1')),
      amount: Money.ofMajor(160_000),
      norm: 'ст. 480 НК РК',
    };
    await repo.replaceTaxRegisters('co-db-1', [tr]);
    const registers = unwrap(await repo.listTaxRegisters('co-db-1'));
    expect(registers).toHaveLength(1);
    expect(registers[0]?.period.code()).toBe('2026-Q1');
    expect(registers[0]?.amount.equals(Money.ofMajor(160_000))).toBe(true);
  });
});
