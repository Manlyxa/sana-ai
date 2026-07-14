import { describe, expect, it } from 'vitest';
import { counterpartyHighRisk } from './counterparty-high-risk';
import { Money } from '../../kernel/money';
import { D, testCounterparty, testInvoice, testRuleContext } from '../../testing/fixtures';

describe('COUNTERPARTY_HIGH_RISK', () => {
  const incoming = testInvoice({ direction: 'IN' }); // от TEST_BIN_2, net 1 000 000, НДС 160 000

  it('СРАБАТЫВАЕТ: лжепредприятие; экспозиция = НДС + КПН 20% с вычета', () => {
    const ctx = testRuleContext({
      counterparties: [testCounterparty({ riskFlags: ['LZHEPREDPRIYATIE'], riskScore: 95 })],
      invoices: [incoming],
    });
    const findings = counterpartyHighRisk.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(360_000))).toBe(true);
    expect(findings[0]?.severity).toBe('CRITICAL');
    expect(findings[0]?.remediation.autonomyLevel).toBe('A0'); // спорная позиция — только человек
    expect(findings[0]?.message).toContain('LZHEPREDPRIYATIE');
  });

  it('СРАБАТЫВАЕТ: несоответствие ОКЭД', () => {
    const ctx = testRuleContext({
      counterparties: [testCounterparty({ riskFlags: ['OKED_MISMATCH'] })],
      invoices: [incoming],
    });
    expect(counterpartyHighRisk.evaluate(ctx, D('2026-04-01'))).toHaveLength(1);
  });

  it('НЕ СРАБАТЫВАЕТ: чистый контрагент; некритичные флаги; исходящие ЭСФ', () => {
    const clean = testRuleContext({ invoices: [incoming] });
    expect(counterpartyHighRisk.evaluate(clean, D('2026-04-01'))).toEqual([]);

    const taxDebtOnly = testRuleContext({
      counterparties: [testCounterparty({ riskFlags: ['TAX_DEBT', 'INACTIVE'] })],
      invoices: [incoming],
    });
    expect(counterpartyHighRisk.evaluate(taxDebtOnly, D('2026-04-01'))).toEqual([]);

    const outgoing = testRuleContext({
      counterparties: [testCounterparty({ riskFlags: ['LZHEPREDPRIYATIE'] })],
      invoices: [testInvoice()],
    });
    expect(counterpartyHighRisk.evaluate(outgoing, D('2026-04-01'))).toEqual([]);
  });
});
