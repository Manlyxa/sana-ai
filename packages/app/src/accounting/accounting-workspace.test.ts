import { describe, expect, it } from 'vitest';
import {
  Bin,
  createBusinessEvent,
  createInvoice,
  LocalDate,
  Money,
  Rate,
  TaxPeriod,
  trialBalance,
  unwrap,
  type BusinessEvent,
  type Invoice,
} from '@sana/domain';
import { MockLlmAdapter } from '@sana/adapters';
import { AccountingWorkspace } from './accounting-workspace';
import { classifyWithAi } from './ai-classifier';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const SUPPLIER_BIN = unwrap(Bin.parse('201140000007'));

let seq = 0;

function testInvoice(): Invoice {
  const net = Money.ofMajor(1_000_000);
  const vat = net.percent(Rate.percent(16));
  return unwrap(
    createInvoice({
      id: 'inv-1',
      number: 'ESF-2026-000123',
      direction: 'OUT',
      turnoverDate: D('2026-02-10'),
      issueDate: D('2026-02-12'),
      counterpartyBin: SUPPLIER_BIN,
      counterpartyName: 'ТОО «Покупатель»',
      lines: [
        { description: 'Консультационные услуги', total: net, vatRate: Rate.percent(16), vatAmount: vat },
      ],
      totalExVat: net,
      vatAmount: vat,
      status: 'ВЫСТАВЛЕН',
      confirmedByRecipientAt: null,
      vatCreditNoticeSentAt: null,
    }),
  );
}

function esfEvent(): BusinessEvent<'ESF_ISSUED'> {
  return unwrap(
    createBusinessEvent({
      id: 'evt-esf-1',
      companyId: 'co-1',
      occurredAt: D('2026-02-10'),
      type: 'ESF_ISSUED',
      payload: { invoice: testInvoice() },
      sourceSystem: 'ИС_ЭСФ',
      sourceDocumentRef: { system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: 'ESF-2026-000123' },
      ingestedAt: D('2026-02-11'),
    }),
  );
}

function bankEvent(
  payload: Partial<BusinessEvent<'BANK_TRANSACTION'>['payload']> = {},
): BusinessEvent<'BANK_TRANSACTION'> {
  seq += 1;
  return unwrap(
    createBusinessEvent({
      id: `evt-bank-${seq}`,
      companyId: 'co-1',
      occurredAt: D('2026-02-10'),
      type: 'BANK_TRANSACTION',
      payload: {
        direction: 'DEBIT',
        amount: Money.ofMajor(250_000),
        counterpartyBin: SUPPLIER_BIN,
        counterpartyName: 'ТОО «Поставщик»',
        purposeText: 'Оплата по счёту 42',
        knp: '710',
        ...payload,
      },
      sourceSystem: 'БАНК',
      sourceDocumentRef: { system: 'БАНК', documentType: 'выписка', documentId: `line-${seq}` },
      ingestedAt: D('2026-02-11'),
    }),
  );
}

describe('AccountingWorkspace — end-to-end (Module 3)', () => {
  it('auto-posts confident proposals (A3) and queues ambiguous ones (A2)', async () => {
    const ws = new AccountingWorkspace('co-1');
    const esf = unwrap(await ws.processEvent(esfEvent()));
    expect(esf.kind).toBe('POSTED');
    const ambiguous = unwrap(await ws.processEvent(bankEvent()));
    expect(ambiguous.kind).toBe('QUEUED');
    expect(ws.pendingOperations()).toHaveLength(1);
    const pending = ws.pendingOperations()[0]!;
    expect(pending.proposal.confidence).toBeLessThan(90);
    expect(pending.proposal.explanation.length).toBeGreaterThan(10);
    const statusChange = unwrap(
      await ws.processEvent(
        unwrap(
          createBusinessEvent({
            id: 'evt-status-1',
            companyId: 'co-1',
            occurredAt: D('2026-02-12'),
            type: 'ESF_STATUS_CHANGED',
            payload: { invoiceId: 'inv-1', from: 'ВЫСТАВЛЕН', to: 'ПОДТВЕРЖДЁН' },
            sourceSystem: 'ИС_ЭСФ',
            sourceDocumentRef: null,
            ingestedAt: D('2026-02-12'),
          }),
        ),
      ),
    );
    expect(statusChange.kind).toBe('NO_ENTRY');
  });

  it('confirmation creates the journal entry AND a reusable rule that auto-posts next time', async () => {
    const ws = new AccountingWorkspace('co-1');
    const queued = unwrap(await ws.processEvent(bankEvent({ purposeText: 'Оплата доставки цветов' })));
    expect(queued.kind).toBe('QUEUED');
    if (queued.kind !== 'QUEUED') return;

    const confirmed = unwrap(
      ws.confirmWithAccount(queued.pending.id, {
        confirmedBy: 'owner@sana',
        at: D('2026-02-15'),
        fromAccount: '3310',
        toAccount: '7110',
        category: 'ДОСТАВКА',
      }),
    );
    expect(confirmed.entry.lines[0]).toMatchObject({ account: '7110', side: 'DEBIT' });
    expect(confirmed.entry.analytics.category).toBe('ДОСТАВКА');
    expect(confirmed.rule?.pattern).toMatchObject({ knp: '710', counterpartyBin: SUPPLIER_BIN.value });
    expect(ws.pendingOperations()).toHaveLength(0);
    expect(ws.operation(queued.pending.id)?.status).toBe('CONFIRMED');

    // The same operation pattern now auto-posts via the learned rule.
    const again = unwrap(await ws.processEvent(bankEvent({ purposeText: 'Оплата доставки воды' })));
    expect(again.kind).toBe('POSTED');
    if (again.kind === 'POSTED') {
      expect(again.proposal.origin).toBe('LEARNED_RULE');
      expect(again.entry.lines[0]).toMatchObject({ account: '7110' });
    }

    // Ledger stays balanced through the whole flow.
    expect(trialBalance(ws.ledger.entries(), TaxPeriod.year(2026)).balanced).toBe(true);
  });

  it('confirm as-is posts the proposed entry unchanged', async () => {
    const ws = new AccountingWorkspace('co-1');
    const queued = unwrap(await ws.processEvent(bankEvent({ knp: null, purposeText: 'аренда офиса' })));
    expect(queued.kind).toBe('QUEUED');
    if (queued.kind !== 'QUEUED') return;
    const confirmed = unwrap(ws.confirm(queued.pending.id, { confirmedBy: 'owner@sana', at: D('2026-02-15') }));
    expect(confirmed.entry.lines[0]).toMatchObject({ account: '7210' });
    expect(confirmed.rule?.pattern.purposeContains).toBeNull();
    expect(confirmed.rule?.pattern.counterpartyBin).toBe(SUPPLIER_BIN.value);
  });

  it('rejection creates no journal entry and no rule', async () => {
    const ws = new AccountingWorkspace('co-1');
    const queued = unwrap(await ws.processEvent(bankEvent()));
    if (queued.kind !== 'QUEUED') throw new Error('ожидалась очередь');
    const before = ws.ledger.size;
    const rejected = unwrap(
      ws.reject(queued.pending.id, { rejectedBy: 'owner@sana', at: D('2026-02-15'), reason: 'личный платёж, не бизнес' }),
    );
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.resolution?.reason).toContain('личный');
    expect(ws.ledger.size).toBe(before);
    expect(ws.learnedRules()).toHaveLength(0);
    // Повторное решение по той же операции невозможно.
    expect(ws.confirm(queued.pending.id, { confirmedBy: 'x', at: D('2026-02-16') }).ok).toBe(false);
    expect(ws.reject(queued.pending.id, { rejectedBy: 'x', at: D('2026-02-16'), reason: 'y' }).ok).toBe(false);
  });

  it('validates queue operations: unknown id, empty reason', async () => {
    const ws = new AccountingWorkspace('co-1');
    expect(ws.confirm('нет', { confirmedBy: 'x', at: D('2026-02-15') }).ok).toBe(false);
    expect(ws.reject('нет', { rejectedBy: 'x', at: D('2026-02-15'), reason: 'r' }).ok).toBe(false);
    const queued = unwrap(await ws.processEvent(bankEvent()));
    if (queued.kind !== 'QUEUED') throw new Error('ожидалась очередь');
    expect(ws.reject(queued.pending.id, { rejectedBy: 'x', at: D('2026-02-15'), reason: '  ' }).ok).toBe(false);
  });

  it('uses the AI classifier for ambiguous bank operations', async () => {
    const llm = new MockLlmAdapter({
      account_suggestion: {
        debitAccount: '7310',
        creditAccount: '1030',
        category: 'ВОЗНАГРАЖДЕНИЯ',
        confidence: 95,
        explanation: 'Выплата вознаграждения по договору займа.',
      },
    });
    const ws = new AccountingWorkspace('co-1', { llm });
    const outcome = unwrap(await ws.processEvent(bankEvent({ knp: null, purposeText: 'вознагр. дог. 77' })));
    // AI at 95% ≥ threshold 90% → auto-post with AI origin.
    expect(outcome.kind).toBe('POSTED');
    if (outcome.kind === 'POSTED') {
      expect(outcome.proposal.origin).toBe('AI');
      expect(outcome.entry.lines[0]).toMatchObject({ account: '7310' });
    }
  });

  it('classifyWithAi degrades to null on malformed replies', async () => {
    const badLlm = new MockLlmAdapter({
      account_suggestion: { debitAccount: '9999', creditAccount: '1030', category: null, confidence: 95, explanation: 'x' },
    });
    expect(await classifyWithAi(badLlm, bankEvent())).toBeNull();
    const noAnswer = new MockLlmAdapter({});
    expect(await classifyWithAi(noAnswer, bankEvent())).toBeNull();
    const invalidConfidence = new MockLlmAdapter({
      account_suggestion: { debitAccount: '7210', creditAccount: '1030', category: 'X', confidence: 90.5, explanation: 'y' },
    });
    expect(await classifyWithAi(invalidConfidence, bankEvent())).toBeNull();
  });

  it('respects a custom auto-post threshold', async () => {
    const ws = new AccountingWorkspace('co-1', { autoPostThreshold: 50 });
    const outcome = unwrap(await ws.processEvent(bankEvent({ knp: null, purposeText: 'аренда' })));
    expect(outcome.kind).toBe('POSTED');
  });
});
