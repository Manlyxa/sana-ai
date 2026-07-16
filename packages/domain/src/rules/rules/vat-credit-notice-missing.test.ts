import { describe, expect, it } from 'vitest';
import { vatCreditNoticeMissing } from './vat-credit-notice-missing';
import { Money } from '../../kernel/money';
import { Rate } from '../../kernel/rate';
import { D, testInvoice, testRuleContext } from '../../testing/fixtures';

describe('VAT_CREDIT_NOTICE_MISSING (п. 8 ст. 480 НК РК)', () => {
  // Оборот 2026-02-10 (Q1) → дедлайн ф.300 = 2026-05-15
  const incoming = testInvoice({ direction: 'IN' });

  it('СРАБАТЫВАЕТ: входящий ЭСФ с НДС без извещения; экспозиция = НДС', () => {
    const ctx = testRuleContext({ invoices: [incoming] });
    const findings = vatCreditNoticeMissing.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.exposure.equals(Money.ofMajor(160_000))).toBe(true);
    expect(f.message).toContain('2026-05-15');
    expect(f.message).toContain('160 000 ₸');
    expect(f.severity).toBe('CRITICAL');
    expect(f.remediation.autonomyLevel).toBe('A3');
  });

  it('после дедлайна сообщение констатирует потерю зачёта', () => {
    const ctx = testRuleContext({ invoices: [incoming] });
    const findings = vatCreditNoticeMissing.evaluate(ctx, D('2026-05-16'));
    expect(findings[0]?.message).toContain('потерян');
  });

  it('НЕ СРАБАТЫВАЕТ: извещение отправлено', () => {
    const sent = testInvoice({ direction: 'IN', vatCreditNoticeSentAt: D('2026-03-01') });
    expect(vatCreditNoticeMissing.evaluate(testRuleContext({ invoices: [sent] }), D('2026-04-01'))).toEqual([]);
  });

  it('НЕ СРАБАТЫВАЕТ: исходящие, черновики, аннулированные, без НДС', () => {
    const net = Money.ofMajor(100_000);
    const noVat = testInvoice({
      id: 'no-vat',
      direction: 'IN',
      lines: [{ description: 'x', total: net, vatRate: Rate.percent(0), vatAmount: Money.zero() }],
      totalExVat: net,
      vatAmount: Money.zero(),
    });
    const ctx = testRuleContext({
      invoices: [
        testInvoice(), // OUT
        testInvoice({ id: 'draft', direction: 'IN', status: 'ЧЕРНОВИК', issueDate: null }),
        testInvoice({ id: 'ann', direction: 'IN', status: 'АННУЛИРОВАН' }),
        noVat,
      ],
    });
    expect(vatCreditNoticeMissing.evaluate(ctx, D('2026-04-01'))).toEqual([]);
  });
});
