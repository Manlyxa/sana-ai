import { describe, expect, it } from 'vitest';
import {
  projectJournal,
  projectJournalEntry,
  projectTaxRegisterEntries,
  projectTaxRegisters,
} from './projections';
import { ACCOUNTS } from './accounts';
import { Money } from '../kernel/money';
import { Rate } from '../kernel/rate';
import { unwrap } from '../kernel/result';
import { D, testEvent, testInvoice, TEST_BIN_2 } from '../testing/fixtures';

const esfOut = () => testEvent('ESF_ISSUED', { invoice: testInvoice() });
const esfIn = () =>
  testEvent(
    'ESF_RECEIVED',
    { invoice: testInvoice({ id: 'inv-in-1', number: 'ESF-2026-000456', direction: 'IN' }) },
    { id: 'evt-esf-in-1' },
  );
const bankIn = () =>
  testEvent(
    'BANK_TRANSACTION',
    {
      direction: 'CREDIT' as const,
      amount: Money.ofMajor(1_160_000),
      counterpartyBin: TEST_BIN_2,
      counterpartyName: 'ТОО «Покупатель»',
      purposeText: 'Оплата по ЭСФ-2026-000123',
      knp: '710',
    },
    { id: 'evt-bank-in', occurredAt: D('2026-02-20'), sourceSystem: 'БАНК' as const },
  );
const bankOut = () =>
  testEvent(
    'BANK_TRANSACTION',
    {
      direction: 'DEBIT' as const,
      amount: Money.ofMajor(500_000),
      counterpartyBin: TEST_BIN_2,
      counterpartyName: 'ТОО «Поставщик»',
      purposeText: 'Оплата поставщику',
      knp: '710',
    },
    { id: 'evt-bank-out', occurredAt: D('2026-02-21'), sourceSystem: 'БАНК' as const },
  );

describe('projectJournalEntry (НСФО)', () => {
  it('исходящий ЭСФ: Дт 1210 (брутто) — Кт 6010 (нетто) + Кт 3130 (НДС)', () => {
    const je = unwrap(projectJournalEntry(esfOut()));
    expect(je).not.toBeNull();
    expect(je?.businessEventId).toBe('evt-esf_issued-1');
    expect(je?.lines).toEqual([
      { account: ACCOUNTS.TRADE_RECEIVABLES, side: 'DEBIT', amount: Money.ofMajor(1_160_000) },
      { account: ACCOUNTS.REVENUE, side: 'CREDIT', amount: Money.ofMajor(1_000_000) },
      { account: ACCOUNTS.VAT_PAYABLE, side: 'CREDIT', amount: Money.ofMajor(160_000) },
    ]);
  });

  it('входящий ЭСФ: Дт 1330 + Дт 1420 — Кт 3310', () => {
    const je = unwrap(projectJournalEntry(esfIn()));
    expect(je?.lines).toEqual([
      { account: ACCOUNTS.INVENTORY_GOODS, side: 'DEBIT', amount: Money.ofMajor(1_000_000) },
      { account: ACCOUNTS.VAT_RECEIVABLE, side: 'DEBIT', amount: Money.ofMajor(160_000) },
      { account: ACCOUNTS.TRADE_PAYABLES, side: 'CREDIT', amount: Money.ofMajor(1_160_000) },
    ]);
  });

  it('ЭСФ без НДС не порождает строку 3130/1420', () => {
    const net = Money.ofMajor(200_000);
    const noVat = testInvoice({
      id: 'inv-novat',
      lines: [{ description: 'Экспорт', total: net, vatRate: Rate.percent(0), vatAmount: Money.zero() }],
      totalExVat: net,
      vatAmount: Money.zero(),
    });
    const je = unwrap(projectJournalEntry(testEvent('ESF_ISSUED', { invoice: noVat }, { id: 'evt-novat' })));
    expect(je?.lines.map((l) => l.account)).toEqual([ACCOUNTS.TRADE_RECEIVABLES, ACCOUNTS.REVENUE]);
  });

  it('банк: поступление Дт 1030 Кт 1210; списание Дт 3310 Кт 1030', () => {
    const inflow = unwrap(projectJournalEntry(bankIn()));
    expect(inflow?.lines.map((l) => `${l.side} ${l.account}`)).toEqual(['DEBIT 1030', 'CREDIT 1210']);
    const outflow = unwrap(projectJournalEntry(bankOut()));
    expect(outflow?.lines.map((l) => `${l.side} ${l.account}`)).toEqual(['DEBIT 3310', 'CREDIT 1030']);
  });

  it('кадровые и статусные события не порождают проводок', () => {
    const statusEvt = testEvent(
      'ESF_STATUS_CHANGED',
      { invoiceId: 'inv-1', from: 'ВЫСТАВЛЕН', to: 'ПОДТВЕРЖДЁН' },
      { id: 'evt-status' },
    );
    expect(unwrap(projectJournalEntry(statusEvt))).toBeNull();
  });
});

describe('projectTaxRegisterEntries (НК РК)', () => {
  it('исходящий ЭСФ: оборот НДС за квартал и СГД за год', () => {
    const entries = projectTaxRegisterEntries(esfOut());
    expect(entries).toHaveLength(2);
    const [nds, kpn] = entries;
    expect(nds?.register).toBe('НДС_ОБОРОТ_РЕАЛИЗАЦИИ');
    expect(nds?.period.code()).toBe('2026-Q1');
    expect(nds?.amount.equals(Money.ofMajor(1_000_000))).toBe(true);
    expect(nds?.norm).toContain('НК РК');
    expect(kpn?.register).toBe('КПН_СГД');
    expect(kpn?.period.code()).toBe('2026');
  });

  it('входящий ЭСФ: вычет КПН и зачёт НДС', () => {
    const entries = projectTaxRegisterEntries(esfIn());
    expect(entries.map((e) => e.register)).toEqual(['КПН_ВЫЧЕТЫ', 'НДС_ЗАЧЁТ']);
    expect(entries[1]?.amount.equals(Money.ofMajor(160_000))).toBe(true);
  });

  it('банковские операции не попадают в налоговые регистры', () => {
    expect(projectTaxRegisterEntries(bankIn())).toEqual([]);
  });
});

describe('P7: двойной регистр', () => {
  const events = [esfOut(), esfIn(), bankIn(), bankOut()];

  it('обе проекции выводятся из одного потока событий независимо', () => {
    const journal = unwrap(projectJournal(events));
    const registers = projectTaxRegisters(events);
    expect(journal).toHaveLength(4); // все четыре события — проводки
    expect(registers).toHaveLength(4); // 2 от исходящего + 2 от входящего ЭСФ
    // связь через businessEventId, а не друг через друга
    const eventIds = new Set(events.map((e) => e.id));
    for (const je of journal) expect(eventIds.has(je.businessEventId)).toBe(true);
    for (const tr of registers) expect(eventIds.has(tr.businessEventId)).toBe(true);
  });

  it('проекции детерминированы и идемпотентны: повторный прогон — тот же результат', () => {
    const a = unwrap(projectJournal(events));
    const b = unwrap(projectJournal(events));
    expect(b).toEqual(a);
    expect(projectTaxRegisters(events)).toEqual(projectTaxRegisters(events));
    expect(a.map((e) => e.id)).toEqual(['je-evt-esf_issued-1', 'je-evt-esf-in-1', 'je-evt-bank-in', 'je-evt-bank-out']);
  });

  it('бухгалтерская и налоговая трактовки расходятся легитимно: банк есть в журнале, но не в регистрах', () => {
    const journal = unwrap(projectJournal([bankIn()]));
    const registers = projectTaxRegisters([bankIn()]);
    expect(journal).toHaveLength(1);
    expect(registers).toHaveLength(0);
  });
});
