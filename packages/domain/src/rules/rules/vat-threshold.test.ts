import { describe, expect, it } from 'vitest';
import { vatThresholdApproaching, vatThresholdBreached, yearTurnover } from './vat-threshold';
import { Money } from '../../kernel/money';
import { Rate } from '../../kernel/rate';
import { D, testCompany, testInvoice, testRuleContext } from '../../testing/fixtures';
import type { Invoice } from '../../entities/invoice';

/** Исходящий ЭСФ без НДС на заданную сумму (компания ещё не плательщик). */
function outInvoice(id: string, netTenge: number, turnover = '2026-03-01'): Invoice {
  const net = Money.ofMajor(netTenge);
  return testInvoice({
    id,
    number: `ESF-${id}`,
    turnoverDate: D(turnover),
    lines: [{ description: 'услуги', total: net, vatRate: Rate.percent(0), vatAmount: Money.zero() }],
    totalExVat: net,
    vatAmount: Money.zero(),
  });
}

const notRegistered = testCompany({ vatStatus: { registered: false } });

describe('ст. 99 НК РК: порог 10 000 МРП = 43 250 000 ₸ (2026)', () => {
  it('yearTurnover: только исходящие, не отменённые, текущий год до asOf', () => {
    const ctx = testRuleContext({
      company: notRegistered,
      invoices: [
        outInvoice('a', 10_000_000),
        { ...outInvoice('b', 5_000_000), status: 'АННУЛИРОВАН' },
        outInvoice('c', 7_000_000, '2025-12-30'), // прошлый год
        outInvoice('d', 3_000_000, '2026-11-01'), // позже asOf
        testInvoice({ id: 'in-1', direction: 'IN' }), // входящий
      ],
    });
    expect(yearTurnover(ctx, D('2026-06-01')).equals(Money.ofMajor(10_000_000))).toBe(true);
  });

  it('APPROACHING СРАБАТЫВАЕТ: оборот 35 млн ≥ 80% порога; экспозиция 50 МРП', () => {
    const ctx = testRuleContext({ company: notRegistered, invoices: [outInvoice('a', 35_000_000)] });
    const findings = vatThresholdApproaching.evaluate(ctx, D('2026-06-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(216_250))).toBe(true); // 50 × 4 325
    expect(vatThresholdBreached.evaluate(ctx, D('2026-06-01'))).toEqual([]);
  });

  it('APPROACHING НЕ СРАБАТЫВАЕТ: ниже 80% (34 599 999 ₸)', () => {
    const ctx = testRuleContext({ company: notRegistered, invoices: [outInvoice('a', 34_599_999)] });
    expect(vatThresholdApproaching.evaluate(ctx, D('2026-06-01'))).toEqual([]);
  });

  it('BREACHED СРАБАТЫВАЕТ: 45 млн; экспозиция = 50 МРП + 15% превышения', () => {
    const ctx = testRuleContext({ company: notRegistered, invoices: [outInvoice('a', 45_000_000)] });
    const findings = vatThresholdBreached.evaluate(ctx, D('2026-06-01'));
    expect(findings).toHaveLength(1);
    // 216 250 + 15% × (45 000 000 − 43 250 000) = 216 250 + 262 500
    expect(findings[0]?.exposure.equals(Money.ofMajor(478_750))).toBe(true);
    expect(findings[0]?.severity).toBe('CRITICAL');
    expect(findings[0]?.remediation.autonomyLevel).toBe('A1');
    // approaching уступает место breached
    expect(vatThresholdApproaching.evaluate(ctx, D('2026-06-01'))).toEqual([]);
  });

  it('НЕ СРАБАТЫВАЮТ: компания уже зарегистрирована по НДС', () => {
    const ctx = testRuleContext({ invoices: [outInvoice('a', 100_000_000)] }); // company: registered
    expect(vatThresholdApproaching.evaluate(ctx, D('2026-06-01'))).toEqual([]);
    expect(vatThresholdBreached.evaluate(ctx, D('2026-06-01'))).toEqual([]);
  });
});
