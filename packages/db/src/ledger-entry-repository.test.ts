import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bin,
  createCompany,
  createLedgerEntry,
  LocalDate,
  Money,
  unwrap,
  type Company,
  type LedgerEntry,
} from '@sana/domain';
import { createInMemoryDb, type Db } from './client';
import { CompanyRepository } from './repositories/company-repository';
import { LedgerEntryRepository } from './repositories/ledger-entry-repository';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const BIN = unwrap(Bin.parse('120540000001'));

function company(): Company {
  return unwrap(
    createCompany({
      id: 'co-le-1',
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

let seq = 0;
function entry(overrides: Partial<Parameters<typeof createLedgerEntry>[0]> = {}): LedgerEntry {
  seq += 1;
  return unwrap(
    createLedgerEntry({
      id: `le-${seq}`,
      companyId: 'co-le-1',
      sourceEventId: `ev-${seq}`,
      date: D('2026-07-05'),
      lines: [
        { account: '7210', side: 'DEBIT', amount: Money.ofMajor(350_000) },
        { account: '3310', side: 'CREDIT', amount: Money.ofMajor(350_000) },
      ],
      memo: 'аренда офиса',
      analytics: { counterpartyBin: '210640001934', counterpartyName: 'ТОО «Есиль»', category: 'Аренда' },
      norm: 'ст. 242 НК РК',
      legalParamsVersion: 'chart@2026-01-01',
      reversesEntryId: null,
      ...overrides,
    }),
  );
}

let db: Db;
let repo: LedgerEntryRepository;

beforeAll(async () => {
  db = await createInMemoryDb();
  await new CompanyRepository(db).upsert(company());
  repo = new LedgerEntryRepository(db);
});

describe('LedgerEntryRepository', () => {
  it('round-trip: сохранённая проводка восстанавливается со всеми полями', async () => {
    const original = entry();
    await repo.append([original]);
    const listed = unwrap(await repo.list('co-le-1'));
    const found = listed.find((e) => e.id === original.id)!;
    expect(found.memo).toBe('аренда офиса');
    expect(found.analytics.counterpartyBin).toBe('210640001934');
    expect(found.analytics.category).toBe('Аренда');
    expect(found.norm).toBe('ст. 242 НК РК');
    expect(found.lines[0]!.amount.toDecimalString()).toBe('350000.00');
    // Период выводится из даты доменной фабрикой.
    expect(found.period.code()).toBe('2026-M07');
  });

  it('append идемпотентен: повторное сохранение не задваивает (append-only по id)', async () => {
    const e = entry();
    await repo.append([e]);
    await repo.append([e]); // повтор
    const listed = unwrap(await repo.list('co-le-1'));
    expect(listed.filter((x) => x.id === e.id)).toHaveLength(1);
  });

  it('сохраняет порядок добавления (seq) для повторного проигрывания', async () => {
    const freshDb = await createInMemoryDb();
    await new CompanyRepository(freshDb).upsert(company());
    const freshRepo = new LedgerEntryRepository(freshDb);
    const a = entry({ id: 'le-order-a', date: D('2026-03-01') });
    const b = entry({ id: 'le-order-b', date: D('2026-01-01') });
    // Добавляем в порядке a, b — несмотря на более раннюю дату b.
    await freshRepo.append([a]);
    await freshRepo.append([b]);
    const listed = unwrap(await freshRepo.list('co-le-1'));
    expect(listed.map((e) => e.id)).toEqual(['le-order-a', 'le-order-b']);
  });
});
