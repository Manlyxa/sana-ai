import { describe, expect, it } from 'vitest';
import { virtualWarehouseMismatch } from './virtual-warehouse-mismatch';
import { Money } from '../../kernel/money';
import { D, testRuleContext } from '../../testing/fixtures';
import type { VirtualWarehouseBalance } from '../context';

function balance(overrides: Partial<VirtualWarehouseBalance> = {}): VirtualWarehouseBalance {
  return {
    productCode: 'GTIN-001',
    name: 'Товар А',
    vsQuantity: 100,
    ledgerQuantity: 100,
    unitValue: Money.ofMajor(10_000),
    ...overrides,
  };
}

describe('VIRTUAL_WAREHOUSE_MISMATCH (блокирует выписку СНТ)', () => {
  it('СРАБАТЫВАЕТ: остатки расходятся; экспозиция = стоимость расхождения', () => {
    const ctx = testRuleContext({ virtualWarehouse: [balance({ vsQuantity: 90 })] });
    const findings = virtualWarehouseMismatch.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(100_000))).toBe(true); // 10 × 10 000
    expect(findings[0]?.message).toContain('СНТ');
  });

  it('НЕ СРАБАТЫВАЕТ: остатки сходятся', () => {
    const ctx = testRuleContext({ virtualWarehouse: [balance()] });
    expect(virtualWarehouseMismatch.evaluate(ctx, D('2026-04-01'))).toEqual([]);
  });
});
