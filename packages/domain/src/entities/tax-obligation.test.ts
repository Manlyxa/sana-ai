import { describe, expect, it } from 'vitest';
import {
  isPastDue,
  OBLIGATION_TRANSITIONS,
  transitionObligation,
  type TaxObligation,
} from './tax-obligation';
import { TaxPeriod } from '../kernel/tax-period';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { D } from '../testing/fixtures';

function obligation(overrides: Partial<TaxObligation> = {}): TaxObligation {
  return {
    id: 'ob-1',
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

describe('TaxObligation', () => {
  it('нормальный путь: PENDING → PREPARED → SIGNED → SUBMITTED → PAID', () => {
    let o = obligation();
    for (const s of ['PREPARED', 'SIGNED', 'SUBMITTED', 'PAID'] as const) {
      o = unwrap(transitionObligation(o, s));
    }
    expect(o.status).toBe('PAID');
  });

  it('нельзя перескочить: PENDING → SIGNED запрещено (сначала подготовка)', () => {
    expect(transitionObligation(obligation(), 'SIGNED').ok).toBe(false);
    expect(transitionObligation(obligation(), 'PAID').ok).toBe(false);
    expect(transitionObligation(obligation({ status: 'PREPARED' }), 'SUBMITTED').ok).toBe(false);
  });

  it('PAID — терминальный', () => {
    const paid = obligation({ status: 'PAID' });
    expect(OBLIGATION_TRANSITIONS.PAID).toEqual([]);
    expect(transitionObligation(paid, 'OVERDUE').ok).toBe(false);
  });

  it('OVERDUE — не тупик: просроченное доводится до исполнения', () => {
    const overdue = obligation({ status: 'OVERDUE' });
    expect(transitionObligation(overdue, 'PREPARED').ok).toBe(true);
    expect(transitionObligation(overdue, 'PAID').ok).toBe(true);
  });

  it('isPastDue: срок прошёл и обязательство не исполнено', () => {
    const o = obligation();
    expect(isPastDue(o, D('2026-05-15'))).toBe(false); // день срока — ещё не просрочка
    expect(isPastDue(o, D('2026-05-16'))).toBe(true);
    expect(isPastDue(obligation({ status: 'SUBMITTED' }), D('2026-06-01'))).toBe(false);
    expect(isPastDue(obligation({ status: 'PAID' }), D('2026-06-01'))).toBe(false);
    expect(isPastDue(obligation({ status: 'OVERDUE' }), D('2026-06-01'))).toBe(true);
  });

  it('сумма может быть ещё не исчислена', () => {
    expect(obligation({ amount: null }).amount).toBeNull();
  });
});
