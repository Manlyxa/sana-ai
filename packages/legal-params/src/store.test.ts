import { describe, expect, it } from 'vitest';
import { LocalDate, Money, unwrap } from '@sana/domain';
import { LegalParameterStore, type LegalParameterInput } from './store';
import { paramKey } from './types';

const D = (iso: string) => unwrap(LocalDate.parse(iso));

const base = {
  norm: 'ст. 9 Закона о бюджете',
  source: 'тест',
  todoVerify: false,
};

function record(key: string, value: unknown, from: string, to: string | null): LegalParameterInput<unknown> {
  return { key, value, validFrom: D(from), validTo: to === null ? null : D(to), ...base };
}

describe('LegalParameterStore', () => {
  const KEY = paramKey<Money>('mrp');

  it('разрешает параметр по дате: границы интервалов включительны', () => {
    const store = unwrap(
      LegalParameterStore.create([
        record('mrp', Money.ofMajor(3_932), '2025-01-01', '2025-12-31'),
        record('mrp', Money.ofMajor(4_325), '2026-01-01', null),
      ]),
    );
    expect(unwrap(store.resolve(KEY, D('2025-01-01'))).value.equals(Money.ofMajor(3_932))).toBe(true);
    expect(unwrap(store.resolve(KEY, D('2025-12-31'))).value.equals(Money.ofMajor(3_932))).toBe(true);
    expect(unwrap(store.resolve(KEY, D('2026-01-01'))).value.equals(Money.ofMajor(4_325))).toBe(true);
    expect(unwrap(store.resolve(KEY, D('2030-06-15'))).value.equals(Money.ofMajor(4_325))).toBe(true);
  });

  it('version — ключ + validFrom, для Justification.parameterVersion', () => {
    const store = unwrap(
      LegalParameterStore.create([record('mrp', Money.ofMajor(4_325), '2026-01-01', null)]),
    );
    expect(unwrap(store.resolve(KEY, D('2026-05-01'))).version).toBe('mrp@2026-01-01');
  });

  it('UNKNOWN_KEY для незарегистрированного ключа', () => {
    const store = unwrap(LegalParameterStore.create([]));
    const r = store.resolve(paramKey<number>('no.such.key'), D('2026-01-01'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('UNKNOWN_KEY');
  });

  it('NOT_IN_EFFECT для даты вне всех интервалов', () => {
    const store = unwrap(
      LegalParameterStore.create([record('mrp', Money.ofMajor(4_325), '2026-01-01', null)]),
    );
    const r = store.resolve(KEY, D('2024-06-01'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('NOT_IN_EFFECT');
      if (r.error.kind === 'NOT_IN_EFFECT') expect(r.error.asOf).toBe('2024-06-01');
    }
  });

  it('отвергает пересекающиеся интервалы одного ключа', () => {
    const r = LegalParameterStore.create([
      record('mrp', 1, '2025-01-01', '2026-01-31'),
      record('mrp', 2, '2026-01-01', null),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.kind).toBe('OVERLAP');
  });

  it('отвергает открытый интервал, за которым следует ещё один', () => {
    const r = LegalParameterStore.create([
      record('mrp', 1, '2025-01-01', null),
      record('mrp', 2, '2026-01-01', null),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.kind).toBe('OVERLAP');
  });

  it('отвергает validTo раньше validFrom', () => {
    const r = LegalParameterStore.create([record('mrp', 1, '2026-01-01', '2025-01-01')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.kind).toBe('INVALID_INTERVAL');
  });

  it('смежные интервалы без зазора и пересечения — валидны', () => {
    const r = LegalParameterStore.create([
      record('mrp', 1, '2025-01-01', '2025-12-31'),
      record('mrp', 2, '2026-01-01', '2026-12-31'),
      record('mrp', 3, '2027-01-01', null),
    ]);
    expect(r.ok).toBe(true);
  });

  it('history возвращает версии по возрастанию validFrom', () => {
    const store = unwrap(
      LegalParameterStore.create([
        record('mrp', 2, '2026-01-01', null),
        record('mrp', 1, '2025-01-01', '2025-12-31'),
      ]),
    );
    expect(store.history('mrp').map((p) => p.version)).toEqual(['mrp@2025-01-01', 'mrp@2026-01-01']);
    expect(store.history('nothing')).toEqual([]);
  });

  it('todoVerify и keys', () => {
    const store = unwrap(
      LegalParameterStore.create([
        record('b.key', 1, '2026-01-01', null),
        { ...record('a.key', 2, '2026-01-01', null), todoVerify: true },
      ]),
    );
    expect(store.todoVerify().map((p) => p.key)).toEqual(['a.key']);
    expect(store.keys()).toEqual(['a.key', 'b.key']);
  });
});
