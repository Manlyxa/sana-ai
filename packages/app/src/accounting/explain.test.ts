import { describe, expect, it } from 'vitest';
import {
  balanceSheet,
  cashFlowStatement,
  createBusinessEvent,
  LocalDate,
  Money,
  profitLossStatement,
  TaxPeriod,
  unwrap,
  type BusinessEvent,
} from '@sana/domain';
import { AccountingWorkspace } from './accounting-workspace';
import { importJournalCsv } from './journal-import';
import { explainLedgerEntry, explainReportLine } from './explain';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const Q1 = TaxPeriod.quarter(2026, 1);

function bankEvent(id: string, direction: 'CREDIT' | 'DEBIT', tenge: number, purpose: string, knp: string | null): BusinessEvent {
  return unwrap(
    createBusinessEvent({
      id,
      companyId: 'co-1',
      occurredAt: D('2026-02-10'),
      type: 'BANK_TRANSACTION',
      payload: {
        direction,
        amount: Money.ofMajor(tenge),
        counterpartyBin: null,
        counterpartyName: 'Контрагент',
        purposeText: purpose,
        knp,
      },
      sourceSystem: 'БАНК',
      sourceDocumentRef: { system: 'БАНК', documentType: 'выписка', documentId: id },
      ingestedAt: D('2026-02-11'),
    }),
  );
}

async function demoWorkspace(): Promise<AccountingWorkspace> {
  const ws = new AccountingWorkspace('co-1', { autoPostThreshold: 50 });
  unwrap(await ws.processEvent(bankEvent('evt-1', 'CREDIT', 500_000, 'оплата по договору 1', null)));
  unwrap(await ws.processEvent(bankEvent('evt-2', 'DEBIT', 200_000, 'аренда офиса', null)));
  unwrap(await ws.processEvent(bankEvent('evt-3', 'DEBIT', 150_000, 'зарплата за январь', '711')));
  return ws;
}

describe('explain — journal entry (Module 5)', () => {
  it('traces an entry back to its source event, norm and legalParamsVersion', async () => {
    const ws = await demoWorkspace();
    const entry = ws.ledger.entries()[0]!;
    const explanation = unwrap(ws.explain({ kind: 'LEDGER_ENTRY', ledgerEntryId: entry.id }));
    expect(explanation.fact).toContain('evt-1');
    expect(explanation.fact).toContain('БАНК');
    expect(explanation.rule).toContain('Дт 1030');
    expect(explanation.rule).toContain('chart-of-accounts.snr@2026-01-01');
    expect(explanation.result).toContain('500000.00');
    expect(explanation.references.sourceEventIds).toEqual(['evt-1']);
    expect(explanation.references.legalParamsVersion).toBe('chart-of-accounts.snr@2026-01-01');
    expect(ws.explain({ kind: 'LEDGER_ENTRY', ledgerEntryId: 'нет' }).ok).toBe(false);
  });

  it('marks reversing entries and works without a resolved event', () => {
    const csv = ['Дата;Дт;Кт;Сумма;Описание', '2026-01-05;1030;5030;100;Взнос'].join('\n');
    const imported = unwrap(importJournalCsv(csv, { companyId: 'co-1', fileName: 'j.csv' }));
    const explanation = explainLedgerEntry(imported.entries[0]!, null);
    expect(explanation.fact).toContain('import:j.csv');
    expect(explanation.references.sourceEventIds[0]).toContain('j.csv');
  });
});

describe('explain — report lines (Module 5)', () => {
  it('explains balance sheet, ОПиУ and ОДДС lines with full references', async () => {
    const ws = await demoWorkspace();
    const bank = unwrap(ws.explain({ kind: 'REPORT_LINE', reportLineId: 'bs:assets:1030', period: Q1 }));
    expect(bank.rule).toContain('Активы = Обязательства + Капитал');
    expect(bank.result).toContain('150000.00'); // 500 − 200 − 150 тыс.
    expect(bank.references.sourceEventIds).toEqual(['evt-1', 'evt-2', 'evt-3']);

    const rent = unwrap(ws.explain({ kind: 'REPORT_LINE', reportLineId: 'pl:expenses:7210', period: Q1 }));
    expect(rent.result).toContain('200000.00');
    expect(rent.references.sourceEventIds).toEqual(['evt-2']);

    const cf = cashFlowStatement(ws.ledger.entries(), Q1);
    const item = cf.operating.items[0]!;
    const flow = unwrap(ws.explain({ kind: 'REPORT_LINE', reportLineId: item.id, period: Q1 }));
    expect(flow.rule).toContain('операционной');
    expect(flow.references.entryIds).toEqual([item.entryId]);

    expect(ws.explain({ kind: 'REPORT_LINE', reportLineId: 'bs:assets:2410', period: Q1 }).ok).toBe(false);
    expect(ws.explain({ kind: 'REPORT_LINE', reportLineId: 'xx:1030', period: Q1 }).ok).toBe(false);
  });

  it('every report line traces completely back to source events', async () => {
    const ws = await demoWorkspace();
    const entries = ws.ledger.entries();
    const knownEvents = new Set(['evt-1', 'evt-2', 'evt-3']);
    const bs = balanceSheet(entries, Q1.end());
    const pl = profitLossStatement(entries, Q1);
    const allLines = [
      ...bs.assets.lines,
      ...bs.liabilities.lines,
      ...bs.equity.lines,
      ...pl.revenue.lines,
      ...pl.expenses.lines,
    ];
    for (const line of allLines) {
      const explained = unwrap(explainReportLine({ lineId: line.id, entries, period: Q1 }));
      // Каждая строка отчёта прослеживается до исходных событий полностью.
      expect(explained.references.entryIds.length).toBeGreaterThan(0);
      for (const src of explained.references.sourceEventIds) {
        expect(knownEvents.has(src)).toBe(true);
      }
      expect(explained.references.sourceEventIds.length).toBe(explained.references.entryIds.length);
    }
  });
});
