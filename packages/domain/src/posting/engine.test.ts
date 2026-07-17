import { describe, expect, it } from 'vitest';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import type { BusinessEvent } from '../ledger/business-event';
import { D, TEST_BIN_2, TEST_IIN_1990, testEvent, testInvoice } from '../testing/fixtures';
import { createLedgerEntry } from '../accounting/ledger-entry';
import { proposePosting } from './engine';
import { classifyBankTransaction } from './heuristics';
import { findLearnedRule, matchesPattern, patternFromEvent, type LearnedPostingRule } from './learned-rules';
import {
  decideRouting,
  replaceAccount,
  toLedgerEntryInput,
  type AccountSuggestion,
} from './proposal';

function bankEvent(
  payload: Partial<BusinessEvent<'BANK_TRANSACTION'>['payload']> = {},
  id = 'evt-bank-1',
): BusinessEvent<'BANK_TRANSACTION'> {
  return testEvent(
    'BANK_TRANSACTION',
    {
      direction: 'DEBIT',
      amount: Money.ofMajor(250_000),
      counterpartyBin: TEST_BIN_2,
      counterpartyName: 'ТОО «Поставщик»',
      purposeText: 'Оплата по счёту 42',
      knp: '710',
      ...payload,
    },
    { id, sourceSystem: 'БАНК' },
  );
}

function learnedRule(overrides: Partial<LearnedPostingRule> = {}): LearnedPostingRule {
  return {
    id: 'rule-1',
    companyId: 'co-1',
    pattern: { direction: 'DEBIT', knp: '710', counterpartyBin: TEST_BIN_2.value, purposeContains: null },
    debitAccount: '7110',
    creditAccount: '1030',
    category: 'ДОСТАВКА',
    createdFromEventId: 'evt-past',
    confirmedBy: 'owner@test',
    createdAt: D('2026-01-15'),
    ...overrides,
  };
}

describe('proposePosting — deterministic cases', () => {
  it('ESF_ISSUED → Дт 1210 Кт 6010 + Кт 3130, confidence 100', () => {
    const event = testEvent('ESF_ISSUED', { invoice: testInvoice() });
    const p = unwrap(proposePosting(event));
    expect(p).not.toBeNull();
    expect(p?.origin).toBe('DETERMINISTIC');
    expect(p?.confidence).toBe(100);
    expect(p?.lines.map((l) => `${l.side === 'DEBIT' ? 'Дт' : 'Кт'}${l.account}`)).toEqual([
      'Дт1210',
      'Кт6010',
      'Кт3130',
    ]);
    expect(p?.norm).toBe('ст. 412 НК РК');
    // Proposal converts into a valid balanced ledger entry.
    expect(createLedgerEntry(toLedgerEntryInput(p!)).ok).toBe(true);
  });

  it('ESF_RECEIVED → Дт 1330 + Дт 1420 Кт 3310', () => {
    const event = testEvent('ESF_RECEIVED', { invoice: testInvoice({ direction: 'IN' }) });
    const p = unwrap(proposePosting(event));
    expect(p?.lines.map((l) => `${l.side === 'DEBIT' ? 'Дт' : 'Кт'}${l.account}`)).toEqual([
      'Дт1330',
      'Дт1420',
      'Кт3310',
    ]);
    expect(createLedgerEntry(toLedgerEntryInput(p!)).ok).toBe(true);
  });

  it('OFD_RECEIPT → Дт 1010 Кт 6010 + Кт 3130 and rejects non-positive net', () => {
    const receipt = {
      receiptId: 'FR-1',
      kkmRegistrationNumber: 'KKM-01',
      total: Money.ofMajor(11_600),
      vatAmount: Money.ofMajor(1_600),
    };
    const p = unwrap(proposePosting(testEvent('OFD_RECEIPT', receipt, { sourceSystem: 'ОФД' })));
    expect(p?.lines.map((l) => l.account)).toEqual(['1010', '6010', '3130']);
    expect(createLedgerEntry(toLedgerEntryInput(p!)).ok).toBe(true);

    const bad = proposePosting(
      testEvent('OFD_RECEIPT', { ...receipt, vatAmount: Money.ofMajor(11_600) }, { sourceSystem: 'ОФД' }),
    );
    expect(bad.ok).toBe(false);
  });

  it('salary and tax КНП codes are deterministic', () => {
    const salary = unwrap(proposePosting(bankEvent({ knp: '712', purposeText: 'перечисление' })));
    expect(salary?.origin).toBe('DETERMINISTIC');
    expect(salary?.confidence).toBe(100);
    expect(salary?.lines[0]).toMatchObject({ account: '3350', side: 'DEBIT' });
    const tax = unwrap(proposePosting(bankEvent({ knp: '911', purposeText: 'перечисление' })));
    expect(tax?.lines[0]).toMatchObject({ account: '3190', side: 'DEBIT' });
  });

  it('non-accounting events produce no proposal', () => {
    const terminated = testEvent('EMPLOYEE_TERMINATED', { iin: TEST_IIN_1990, terminatedAt: D('2026-02-01') });
    expect(unwrap(proposePosting(terminated))).toBeNull();
  });

  it('same input → same proposal (determinism)', () => {
    const event = bankEvent({ knp: null, purposeText: 'Оплата аренды офиса за март' });
    const a = unwrap(proposePosting(event));
    const b = unwrap(proposePosting(event));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('heuristics', () => {
  it('classifies debit purposes by keywords with confidence < 100', () => {
    const base = bankEvent().payload;
    expect(classifyBankTransaction({ ...base, knp: null, purposeText: 'Аренда офиса' })).toMatchObject({
      debitAccount: '7210',
      category: 'АРЕНДА',
      deterministic: false,
    });
    expect(classifyBankTransaction({ ...base, knp: null, purposeText: 'зарплата за март' }).debitAccount).toBe('3350');
    expect(classifyBankTransaction({ ...base, knp: null, purposeText: 'налог ИПН' }).debitAccount).toBe('3190');
    expect(classifyBankTransaction({ ...base, knp: null, purposeText: 'услуги связи' }).debitAccount).toBe('7210');
    const unknown = classifyBankTransaction({ ...base, knp: null, purposeText: 'xyz' });
    expect(unknown.debitAccount).toBe('3310');
    expect(unknown.confidence).toBeLessThan(90);
  });

  it('classifies credit purposes', () => {
    const base = { ...bankEvent().payload, direction: 'CREDIT' as const, knp: null };
    expect(classifyBankTransaction({ ...base, purposeText: 'займ от учредителя' }).creditAccount).toBe('4030');
    expect(classifyBankTransaction({ ...base, purposeText: 'оплата по договору 7' }).creditAccount).toBe('1210');
    const unknown = classifyBankTransaction({ ...base, purposeText: '---' });
    expect(unknown.creditAccount).toBe('1210');
    expect(unknown.confidence).toBe(60);
  });
});

describe('learned rules', () => {
  it('confirmed rules take precedence over heuristics and КНП rules', () => {
    // КНП 710 is not a deterministic code; heuristic default would be 3310.
    const event = bankEvent({ purposeText: 'Оплата доставки' });
    const withoutRule = unwrap(proposePosting(event));
    expect(withoutRule?.origin).toBe('HEURISTIC');
    const withRule = unwrap(proposePosting(event, { learnedRules: [learnedRule()] }));
    expect(withRule?.origin).toBe('LEARNED_RULE');
    expect(withRule?.ruleId).toBe('rule-1');
    expect(withRule?.confidence).toBe(100);
    expect(withRule?.lines[0]).toMatchObject({ account: '7110' });
    expect(withRule?.analytics.category).toBe('ДОСТАВКА');
  });

  it('most specific pattern wins; ties go to the most recently confirmed', () => {
    const generic = learnedRule({
      id: 'rule-generic',
      pattern: { direction: 'DEBIT', knp: '710', counterpartyBin: null, purposeContains: null },
      debitAccount: '7210',
    });
    const specific = learnedRule({ id: 'rule-specific' });
    const event = bankEvent();
    expect(findLearnedRule([specific, generic], event)?.id).toBe('rule-specific');
    const newer = learnedRule({ id: 'rule-newer', debitAccount: '7310' });
    expect(findLearnedRule([specific, newer], event)?.id).toBe('rule-newer');
    expect(findLearnedRule([generic], bankEvent({ knp: '999' }))).toBeNull();
    const foreign = learnedRule({ id: 'rule-foreign', companyId: 'co-2' });
    expect(findLearnedRule([foreign], event)).toBeNull();
  });

  it('matchesPattern checks every specified field', () => {
    const p = bankEvent().payload;
    expect(matchesPattern({ direction: 'CREDIT', knp: null, counterpartyBin: null, purposeContains: null }, p)).toBe(false);
    expect(matchesPattern({ direction: 'DEBIT', knp: '711', counterpartyBin: null, purposeContains: null }, p)).toBe(false);
    expect(matchesPattern({ direction: 'DEBIT', knp: null, counterpartyBin: '000000000000', purposeContains: null }, p)).toBe(false);
    expect(matchesPattern({ direction: 'DEBIT', knp: null, counterpartyBin: null, purposeContains: 'аренда' }, p)).toBe(false);
    expect(matchesPattern({ direction: 'DEBIT', knp: null, counterpartyBin: null, purposeContains: 'оплата' }, p)).toBe(true);
  });

  it('patternFromEvent prefers КНП/контрагент and falls back to purpose text', () => {
    expect(patternFromEvent(bankEvent())).toEqual({
      direction: 'DEBIT',
      knp: '710',
      counterpartyBin: TEST_BIN_2.value,
      purposeContains: null,
    });
    const noIds = bankEvent({ knp: null, counterpartyBin: null, purposeText: '  Подписка SaaS  ' });
    expect(patternFromEvent(noIds).purposeContains).toBe('подписка saas');
    const empty = bankEvent({ knp: null, counterpartyBin: null, purposeText: '   ' });
    expect(patternFromEvent(empty).purposeContains).toBeNull();
  });
});

describe('AI suggestion and routing', () => {
  const aiSuggestion: AccountSuggestion = {
    debitAccount: '7310',
    creditAccount: '1030',
    category: 'ВОЗНАГРАЖДЕНИЯ',
    confidence: 76,
    explanation: 'Похоже на выплату вознаграждения по займу.',
  };

  it('uses the AI suggestion only when it beats the heuristic', () => {
    const vague = bankEvent({ knp: null, purposeText: 'x-42' });
    const withAi = unwrap(proposePosting(vague, { aiSuggestion }));
    expect(withAi?.origin).toBe('AI');
    expect(withAi?.confidence).toBe(76);
    expect(withAi?.lines[0]).toMatchObject({ account: '7310' });

    const keyworded = bankEvent({ knp: null, purposeText: 'аренда склада' });
    const heuristicWins = unwrap(proposePosting(keyworded, { aiSuggestion }));
    expect(heuristicWins?.origin).toBe('HEURISTIC');

    const salaried = bankEvent({ knp: '711' });
    const deterministicWins = unwrap(proposePosting(salaried, { aiSuggestion: { ...aiSuggestion, confidence: 99 } }));
    expect(deterministicWins?.origin).toBe('DETERMINISTIC');
  });

  it('routes by the configurable confidence threshold', () => {
    const confident = unwrap(proposePosting(bankEvent({ knp: '711' })));
    expect(decideRouting(confident!)).toBe('AUTO_POST');
    const vague = unwrap(proposePosting(bankEvent({ knp: null, purposeText: 'аренда' })));
    expect(decideRouting(vague!)).toBe('CONFIRMATION_QUEUE');
    expect(decideRouting(vague!, 80)).toBe('AUTO_POST');
    expect(() => decideRouting(vague!, 101)).toThrow();
    expect(() => decideRouting(vague!, 12.5)).toThrow();
  });

  it('replaceAccount rewrites only the requested account', () => {
    const p = unwrap(proposePosting(bankEvent({ knp: null, purposeText: 'аренда' })));
    const lines = replaceAccount(p!.lines, '7210', '7110');
    expect(lines[0]).toMatchObject({ account: '7110', side: 'DEBIT' });
    expect(lines[1]).toMatchObject({ account: '1030', side: 'CREDIT' });
  });
});
