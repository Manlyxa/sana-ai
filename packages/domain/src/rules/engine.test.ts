import { describe, expect, it } from 'vitest';
import { diffFindings, evaluateRules } from './engine';
import { ALL_RULES } from './all';
import { makeFinding } from './helpers';
import { Money } from '../kernel/money';
import { D, testInvoice, testRuleContext } from '../testing/fixtures';

describe('движок правил (§7)', () => {
  it('РЕЕСТР: все 18 правил MVP зарегистрированы', () => {
    expect(ALL_RULES.map((r) => r.id).sort()).toEqual([
      'COUNTERPARTY_HIGH_RISK',
      'EMPLOYMENT_CONTRACT_NOT_REGISTERED',
      'ESF_CONFIRMATION_PENDING',
      'ESF_ISSUE_OVERDUE',
      'ESF_NONRESIDENT_OVERDUE',
      'FILING_DEADLINE_APPROACHING',
      'FILING_OVERDUE',
      'FINAL_SETTLEMENT_OVERDUE',
      'IPN_DEDUCTION_NO_APPLICATION',
      'OPVR_AGE_EXEMPTION_VIOLATED',
      'PAYMENT_OVERDUE',
      'SNR_SUPPLIER_DEDUCTION',
      'TAX_NOTICE_UNANSWERED',
      'UNCLEARED_ADVANCE',
      'VAT_CREDIT_NOTICE_MISSING',
      'VAT_THRESHOLD_APPROACHING',
      'VAT_THRESHOLD_BREACHED',
      'VIRTUAL_WAREHOUSE_MISMATCH',
    ]);
  });

  it('ЧИСТЫЕ ДАННЫЕ: на здоровой компании ни одно правило не срабатывает', () => {
    const findings = evaluateRules(testRuleContext(), D('2026-04-01'));
    expect(findings).toEqual([]);
  });

  it('идемпотентность: повторный прогон — байт-в-байт тот же результат', () => {
    const ctx = testRuleContext({
      invoices: [testInvoice({ direction: 'IN' })], // без извещения о зачёте
    });
    const a = evaluateRules(ctx, D('2026-04-01'));
    const b = evaluateRules(ctx, D('2026-04-01'));
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('лента отсортирована по тенге под риском (по убыванию)', () => {
    const ctx = testRuleContext({
      invoices: [
        testInvoice({ direction: 'IN' }), // зачёт 160 000 под риском
        testInvoice({ id: 'inv-draft', number: 'ESF-DRAFT', status: 'ЧЕРНОВИК', issueDate: null, turnoverDate: D('2026-01-05') }),
        // черновик: штраф 40 МРП = 173 000
      ],
    });
    const findings = evaluateRules(ctx, D('2026-04-01'));
    expect(findings.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1];
      const curr = findings[i];
      expect(prev!.exposure.compareTo(curr!.exposure)).toBeGreaterThanOrEqual(0);
    }
  });

  it('каждая находка несёт Justification и remediation с уровнем автономности', () => {
    const ctx = testRuleContext({ invoices: [testInvoice({ direction: 'IN' })] });
    for (const f of evaluateRules(ctx, D('2026-04-01'))) {
      expect(f.justification.norm).toBeTruthy();
      expect(f.justification.parameterVersion).toBe('legal-params@2026-01-01');
      expect(f.justification.sourceDocuments.length).toBeGreaterThan(0);
      expect(f.remediation.autonomyLevel).toMatch(/^A[0-3]$/);
    }
  });

  it('diffFindings: решённая находка не поднимается заново', () => {
    const ctx = testRuleContext();
    const asOf = D('2026-04-01');
    const mk = (subjectId: string) =>
      makeFinding(ctx, asOf, {
        ruleId: 'X',
        severity: 'HIGH',
        norm: 'тест',
        subjectId,
        exposure: Money.ofMajor(1),
        message: 'тест',
        sourceDocuments: [{ system: 'SANA', documentType: 't', documentId: subjectId }],
        remediation: { kind: 'T', description: 't', autonomyLevel: 'A3' },
      });
    const a = mk('a');
    const b = mk('b');
    const c = mk('c');
    const diff = diffFindings([a, b], [b, c]);
    expect(diff.added.map((f) => f.id)).toEqual(['X:c']);
    expect(diff.retained.map((f) => f.id)).toEqual(['X:b']);
    expect(diff.resolved.map((f) => f.id)).toEqual(['X:a']);
  });

  it('defineRule: financialExposure = сумма экспозиций находок', () => {
    const ctx = testRuleContext({
      invoices: [
        testInvoice({ direction: 'IN' }),
        testInvoice({ id: 'inv-2', number: 'ESF-2', direction: 'IN' }),
      ],
    });
    const rule = ALL_RULES.find((r) => r.id === 'VAT_CREDIT_NOTICE_MISSING')!;
    expect(rule.financialExposure(ctx, D('2026-04-01')).equals(Money.ofMajor(320_000))).toBe(true);
  });
});
