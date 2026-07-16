import { describe, expect, it } from 'vitest';
import { filingDeadlineApproaching, filingOverdue, paymentOverdue } from './filing-deadlines';
import { Money } from '../../kernel/money';
import { TaxPeriod } from '../../kernel/tax-period';
import { D, testRuleContext } from '../../testing/fixtures';
import type { TaxObligation } from '../../entities/tax-obligation';

function fno300(overrides: Partial<TaxObligation> = {}): TaxObligation {
  return {
    id: 'ob-300-q1',
    companyId: 'co-1',
    kind: 'ФНО_300',
    period: TaxPeriod.quarter(2026, 1),
    dueDate: D('2026-05-15'),
    amount: Money.ofMajor(2_340_000),
    status: 'PENDING',
    autonomyLevel: 'A1',
    ...overrides,
  };
}

describe('FILING_DEADLINE_APPROACHING', () => {
  it('СРАБАТЫВАЕТ: до срока ≤ 10 дней, форма не подписана; экспозиция = сумма', () => {
    const ctx = testRuleContext({ obligations: [fno300()] });
    const findings = filingDeadlineApproaching.evaluate(ctx, D('2026-05-10'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(2_340_000))).toBe(true);
    expect(findings[0]?.remediation.autonomyLevel).toBe('A1');
  });

  it('без суммы экспозиция = штраф 30 МРП', () => {
    const ctx = testRuleContext({ obligations: [fno300({ amount: null })] });
    const findings = filingDeadlineApproaching.evaluate(ctx, D('2026-05-10'));
    expect(findings[0]?.exposure.equals(Money.ofMajor(129_750))).toBe(true);
  });

  it('НЕ СРАБАТЫВАЕТ: рано (11+ дней), уже подписана, уже просрочена', () => {
    expect(
      filingDeadlineApproaching.evaluate(testRuleContext({ obligations: [fno300()] }), D('2026-05-04')),
    ).toEqual([]);
    expect(
      filingDeadlineApproaching.evaluate(
        testRuleContext({ obligations: [fno300({ status: 'SIGNED' })] }),
        D('2026-05-10'),
      ),
    ).toEqual([]);
    expect(
      filingDeadlineApproaching.evaluate(testRuleContext({ obligations: [fno300()] }), D('2026-05-16')),
    ).toEqual([]);
  });
});

describe('FILING_OVERDUE (КоАП РК)', () => {
  it('СРАБАТЫВАЕТ: срок прошёл; экспозиция = штраф 30 МРП', () => {
    const ctx = testRuleContext({ obligations: [fno300()] });
    const findings = filingOverdue.evaluate(ctx, D('2026-05-16'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(129_750))).toBe(true);
    expect(findings[0]?.severity).toBe('CRITICAL');
  });

  it('НЕ СРАБАТЫВАЕТ: сдана (SUBMITTED) или срок не прошёл', () => {
    expect(
      filingOverdue.evaluate(
        testRuleContext({ obligations: [fno300({ status: 'SUBMITTED' })] }),
        D('2026-06-01'),
      ),
    ).toEqual([]);
    expect(filingOverdue.evaluate(testRuleContext({ obligations: [fno300()] }), D('2026-05-15'))).toEqual([]);
  });
});

describe('PAYMENT_OVERDUE', () => {
  const payment = fno300({
    id: 'ob-nds-pay',
    kind: 'НДС_ПЛАТЁЖ',
    dueDate: D('2026-05-25'),
  });

  it('СРАБАТЫВАЕТ: налог исчислен и не уплачен к 25-му; экспозиция = сумма', () => {
    const ctx = testRuleContext({ obligations: [payment] });
    const findings = paymentOverdue.evaluate(ctx, D('2026-05-26'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(2_340_000))).toBe(true);
    expect(findings[0]?.message).toContain('пеня');
  });

  it('НЕ СРАБАТЫВАЕТ: уплачен или срок не наступил', () => {
    expect(
      paymentOverdue.evaluate(testRuleContext({ obligations: [{ ...payment, status: 'PAID' }] }), D('2026-06-01')),
    ).toEqual([]);
    expect(paymentOverdue.evaluate(testRuleContext({ obligations: [payment] }), D('2026-05-25'))).toEqual([]);
    // ФНО не считается платёжным обязательством
    expect(paymentOverdue.evaluate(testRuleContext({ obligations: [fno300()] }), D('2026-06-01'))).toEqual([]);
  });
});
