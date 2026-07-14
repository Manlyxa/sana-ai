import { describe, expect, it } from 'vitest';
import { InMemoryBusinessEventStore } from './event-store';
import { createBusinessEvent } from './business-event';
import { TaxPeriod } from '../kernel/tax-period';
import { unwrap } from '../kernel/result';
import { D, testEvent, testInvoice } from '../testing/fixtures';
import { Money } from '../kernel/money';

const esf = () => testEvent('ESF_ISSUED', { invoice: testInvoice() });
const bank = () =>
  testEvent(
    'BANK_TRANSACTION',
    {
      direction: 'CREDIT',
      amount: Money.ofMajor(1_160_000),
      counterpartyBin: null,
      counterpartyName: 'ТОО «Покупатель»',
      purposeText: 'Оплата по счёту',
      knp: '710',
    },
    { id: 'evt-bank-1', occurredAt: D('2026-04-05'), sourceSystem: 'БАНК' },
  );

describe('createBusinessEvent', () => {
  it('замораживает событие (неизменяемость)', () => {
    const e = esf();
    expect(Object.isFrozen(e)).toBe(true);
  });

  it('отвергает пустые id/companyId', () => {
    expect(createBusinessEvent({ ...esf(), id: ' ' }).ok).toBe(false);
    expect(createBusinessEvent({ ...esf(), companyId: '' }).ok).toBe(false);
  });
});

describe('InMemoryBusinessEventStore', () => {
  it('append-only: дубликат id отвергается', () => {
    const store = new InMemoryBusinessEventStore();
    expect(store.append(esf()).ok).toBe(true);
    const dup = store.append(esf());
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toEqual({ kind: 'DUPLICATE_ID', id: 'evt-esf_issued-1' });
    expect(store.size).toBe(1);
  });

  it('appendAll останавливается на первом дубликате', () => {
    const store = new InMemoryBusinessEventStore();
    const r = store.appendAll([esf(), bank(), esf()]);
    expect(r.ok).toBe(false);
    expect(store.size).toBe(2); // первые два легли, третий отвергнут
  });

  it('all возвращает копию списка — мутация снаружи не влияет', () => {
    const store = new InMemoryBusinessEventStore();
    unwrap(store.append(esf()));
    const list = store.all() as unknown[];
    list.pop();
    expect(store.size).toBe(1);
  });

  it('фильтры: forCompany / ofType / inPeriod', () => {
    const store = new InMemoryBusinessEventStore();
    unwrap(store.append(esf()));
    unwrap(store.append(bank()));
    unwrap(
      store.append(
        testEvent('ESF_RECEIVED', { invoice: testInvoice({ id: 'inv-2', direction: 'IN' }) }, {
          id: 'evt-esf-in',
          companyId: 'co-2',
        }),
      ),
    );

    expect(store.forCompany('co-1').map((e) => e.id)).toEqual(['evt-esf_issued-1', 'evt-bank-1']);
    expect(store.ofType('ESF_ISSUED')).toHaveLength(1);
    expect(store.ofType('BANK_TRANSACTION')[0]?.payload.knp).toBe('710');
    expect(store.inPeriod(TaxPeriod.quarter(2026, 1)).map((e) => e.id)).toEqual([
      'evt-esf_issued-1',
      'evt-esf-in',
    ]);
    expect(store.inPeriod(TaxPeriod.quarter(2026, 2)).map((e) => e.id)).toEqual(['evt-bank-1']);
  });
});
