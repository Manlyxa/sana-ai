import { describe, expect, it } from 'vitest';
import { unclearedAdvance } from './uncleared-advance';
import { Money } from '../../kernel/money';
import { D, testRuleContext, TEST_IIN_1990 } from '../../testing/fixtures';
import type { OutstandingAdvance } from '../context';

function advance(overrides: Partial<OutstandingAdvance> = {}): OutstandingAdvance {
  return {
    id: 'adv-1',
    employeeIin: TEST_IIN_1990,
    issuedAt: D('2023-01-15'),
    amount: Money.ofMajor(500_000),
    clearedAt: null,
    ...overrides,
  };
}

describe('UNCLEARED_ADVANCE (подотчёт > 3 лет)', () => {
  it('СРАБАТЫВАЕТ: аванс 2023 года не закрыт в 2026; экспозиция = ИПН 10%', () => {
    const ctx = testRuleContext({ advances: [advance()] });
    const findings = unclearedAdvance.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(50_000))).toBe(true);
    expect(findings[0]?.message).toContain('3 лет');
  });

  it('НЕ СРАБАТЫВАЕТ: закрыт, моложе 3 лет, ровно 3 года', () => {
    expect(
      unclearedAdvance.evaluate(
        testRuleContext({ advances: [advance({ clearedAt: D('2024-06-01') })] }),
        D('2026-04-01'),
      ),
    ).toEqual([]);
    expect(
      unclearedAdvance.evaluate(testRuleContext({ advances: [advance({ issuedAt: D('2024-06-01') })] }), D('2026-04-01')),
    ).toEqual([]);
    expect(
      unclearedAdvance.evaluate(testRuleContext({ advances: [advance()] }), D('2026-01-15')),
    ).toEqual([]);
  });
});
