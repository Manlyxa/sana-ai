import { describe, expect, it } from 'vitest';
import { esfIssueOverdue } from './esf-issue-overdue';
import { Money } from '../../kernel/money';
import { D, testInvoice, testRuleContext } from '../../testing/fixtures';

describe('ESF_ISSUE_OVERDUE (ст. 493 НК РК)', () => {
  const draft = testInvoice({ status: 'ЧЕРНОВИК', issueDate: null, turnoverDate: D('2026-02-10') });

  it('СРАБАТЫВАЕТ: оборот 16 дней назад, ЭСФ не выставлен; экспозиция 40 МРП', () => {
    const findings = esfIssueOverdue.evaluate(testRuleContext({ invoices: [draft] }), D('2026-02-26'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(173_000))).toBe(true); // 40 × 4 325
    expect(findings[0]?.message).toContain('2026-02-25'); // дедлайн = оборот + 15 дней
  });

  it('НЕ СРАБАТЫВАЕТ: ровно 15-й день — срок ещё не истёк', () => {
    expect(esfIssueOverdue.evaluate(testRuleContext({ invoices: [draft] }), D('2026-02-25'))).toEqual([]);
  });

  it('НЕ СРАБАТЫВАЕТ: ЭСФ выставлен; входящие черновиками не считаем', () => {
    const ctx = testRuleContext({
      invoices: [
        testInvoice({ turnoverDate: D('2026-01-01') }), // ВЫСТАВЛЕН
        testInvoice({ id: 'in-draft', direction: 'IN', status: 'ЧЕРНОВИК', issueDate: null, turnoverDate: D('2026-01-01') }),
      ],
    });
    expect(esfIssueOverdue.evaluate(ctx, D('2026-04-01'))).toEqual([]);
  });
});
