import { describe, expect, it } from 'vitest';
import { esfNonresidentOverdue } from './esf-nonresident-overdue';
import { Money } from '../../kernel/money';
import { D, testRuleContext } from '../../testing/fixtures';
import type { NonResidentVatPayment } from '../context';

describe('ESF_NONRESIDENT_OVERDUE (п. 9 ст. 493 НК РК)', () => {
  const payment: NonResidentVatPayment = {
    id: 'nrp-1',
    paidAt: D('2026-02-01'),
    vatAmount: Money.ofMajor(240_000),
    esfIssuedAt: null,
  };

  it('СРАБАТЫВАЕТ: НДС за нерезидента уплачен, 5 дней прошло, ЭСФ нет', () => {
    const ctx = testRuleContext({ nonResidentVatPayments: [payment] });
    const findings = esfNonresidentOverdue.evaluate(ctx, D('2026-02-07'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(173_000))).toBe(true);
  });

  it('НЕ СРАБАТЫВАЕТ: срок ещё идёт (день 5) или ЭСФ выписан', () => {
    const ctx1 = testRuleContext({ nonResidentVatPayments: [payment] });
    expect(esfNonresidentOverdue.evaluate(ctx1, D('2026-02-06'))).toEqual([]);
    const ctx2 = testRuleContext({
      nonResidentVatPayments: [{ ...payment, esfIssuedAt: D('2026-02-03') }],
    });
    expect(esfNonresidentOverdue.evaluate(ctx2, D('2026-03-01'))).toEqual([]);
  });
});
