import { describe, expect, it } from 'vitest';
import { esfConfirmationPending } from './esf-confirmation-pending';
import { Money } from '../../kernel/money';
import { D, testInvoice, testRuleContext } from '../../testing/fixtures';

describe('ESF_CONFIRMATION_PENDING (ст. 499–501 НК РК)', () => {
  it('СРАБАТЫВАЕТ: входящий ЭСФ ожидает подтверждения; экспозиция = НДС', () => {
    const ctx = testRuleContext({ invoices: [testInvoice({ direction: 'IN', status: 'ВЫСТАВЛЕН' })] });
    const findings = esfConfirmationPending.evaluate(ctx, D('2026-03-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(160_000))).toBe(true);
    expect(findings[0]?.remediation.autonomyLevel).toBe('A2');
  });

  it('НЕ СРАБАТЫВАЕТ: подтверждённые и исходящие', () => {
    const ctx = testRuleContext({
      invoices: [
        testInvoice({ direction: 'IN', status: 'ПОДТВЕРЖДЁН', confirmedByRecipientAt: D('2026-02-15') }),
        testInvoice({ id: 'out-1' }), // OUT ВЫСТАВЛЕН
      ],
    });
    expect(esfConfirmationPending.evaluate(ctx, D('2026-03-01'))).toEqual([]);
  });
});
