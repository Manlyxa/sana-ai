import { describe, expect, it } from 'vitest';
import { employmentContractNotRegistered, finalSettlementOverdue } from './hr-compliance';
import { Money } from '../../kernel/money';
import { D, testEmployee, testRuleContext, TEST_IIN_1990 } from '../../testing/fixtures';
import type { FinalSettlement } from '../context';

describe('EMPLOYMENT_CONTRACT_NOT_REGISTERED (ст. 35 ТК РК, срок TODO_VERIFY)', () => {
  const unregistered = testEmployee({ esutdRegisteredAt: null, hiredAt: D('2026-01-05') });

  it('СРАБАТЫВАЕТ: 5 рабочих дней прошло, регистрации нет; экспозиция 30 МРП', () => {
    const ctx = testRuleContext({ employees: [unregistered] });
    // приём пн 05.01 → дедлайн пн 12.01; 13.01 — просрочка
    const findings = employmentContractNotRegistered.evaluate(ctx, D('2026-01-13'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(129_750))).toBe(true);
    expect(findings[0]?.justification.norm).toContain('TODO_VERIFY');
  });

  it('НЕ СРАБАТЫВАЕТ: срок ещё идёт, зарегистрирован, уволен', () => {
    const ctx = testRuleContext({ employees: [unregistered] });
    expect(employmentContractNotRegistered.evaluate(ctx, D('2026-01-12'))).toEqual([]);

    const registered = testRuleContext({ employees: [testEmployee({ hiredAt: D('2026-01-05') })] });
    expect(employmentContractNotRegistered.evaluate(registered, D('2026-02-01'))).toEqual([]);

    const gone = testRuleContext({
      employees: [testEmployee({ esutdRegisteredAt: null, hiredAt: D('2026-01-05'), terminatedAt: D('2026-01-20') })],
    });
    expect(employmentContractNotRegistered.evaluate(gone, D('2026-02-01'))).toEqual([]);
  });
});

describe('FINAL_SETTLEMENT_OVERDUE (ст. 113 ТК РК: 3 рабочих дня)', () => {
  const settlement: FinalSettlement = {
    employeeIin: TEST_IIN_1990,
    terminatedAt: D('2026-03-02'), // понедельник → дедлайн чт 05.03
    amountDue: Money.ofMajor(430_000),
    paidAt: null,
  };

  it('СРАБАТЫВАЕТ: не выплачен после 3 рабочих дней; экспозиция = сумма', () => {
    const ctx = testRuleContext({ finalSettlements: [settlement] });
    const findings = finalSettlementOverdue.evaluate(ctx, D('2026-03-06'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(430_000))).toBe(true);
    expect(findings[0]?.remediation.autonomyLevel).toBe('A1');
  });

  it('НЕ СРАБАТЫВАЕТ: выплачен или срок ещё идёт', () => {
    const paid = testRuleContext({ finalSettlements: [{ ...settlement, paidAt: D('2026-03-04') }] });
    expect(finalSettlementOverdue.evaluate(paid, D('2026-04-01'))).toEqual([]);
    const inTime = testRuleContext({ finalSettlements: [settlement] });
    expect(finalSettlementOverdue.evaluate(inTime, D('2026-03-05'))).toEqual([]);
  });
});
