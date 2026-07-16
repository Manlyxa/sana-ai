import { describe, expect, it } from 'vitest';
import { snrSupplierDeduction } from './snr-supplier-deduction';
import { Money } from '../../kernel/money';
import { D, testCompany, testCounterparty, testInvoice, testRuleContext } from '../../testing/fixtures';

describe('SNR_SUPPLIER_DEDUCTION (НК РК 2026, TODO_VERIFY)', () => {
  const incoming = testInvoice({ direction: 'IN' });

  it('СРАБАТЫВАЕТ: поставщик на упрощёнке; экспозиция = КПН 20% с расхода', () => {
    const ctx = testRuleContext({
      counterparties: [testCounterparty({ taxRegime: 'СНР_УПРОЩЁНКА' })],
      invoices: [incoming],
    });
    const findings = snrSupplierDeduction.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(200_000))).toBe(true);
    expect(findings[0]?.justification.norm).toContain('TODO_VERIFY');
  });

  it('НЕ СРАБАТЫВАЕТ: поставщик на ОУР или режим неизвестен', () => {
    for (const regime of ['ОУР', 'НЕИЗВЕСТНО'] as const) {
      const ctx = testRuleContext({
        counterparties: [testCounterparty({ taxRegime: regime })],
        invoices: [incoming],
      });
      expect(snrSupplierDeduction.evaluate(ctx, D('2026-04-01'))).toEqual([]);
    }
  });

  it('НЕ СРАБАТЫВАЕТ: сама компания не на ОУР (вычеты по КПН не применяются)', () => {
    const ctx = testRuleContext({
      company: testCompany({ taxRegime: 'СНР_УПРОЩЁНКА' }),
      counterparties: [testCounterparty({ taxRegime: 'СНР_УПРОЩЁНКА' })],
      invoices: [incoming],
    });
    expect(snrSupplierDeduction.evaluate(ctx, D('2026-04-01'))).toEqual([]);
  });
});
