import { describe, expect, it } from 'vitest';
import {
  createLedgerEntry,
  LocalDate,
  Money,
  unwrap,
  type LedgerEntry,
} from '@sana/domain';
import { FixtureCounterpartyRegistryAdapter } from '@sana/adapters';
import { checkCounterparty, listCompanyCounterparties } from './counterparties';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const registry = new FixtureCounterpartyRegistryAdapter();

let seq = 0;
function entry(bin: string | null, name: string | null, tenge: number): LedgerEntry {
  seq += 1;
  return unwrap(
    createLedgerEntry({
      id: `le-${seq}`,
      companyId: 'demo-too',
      sourceEventId: `ev-${seq}`,
      date: D('2026-07-05'),
      lines: [
        { account: '7210', side: 'DEBIT', amount: Money.ofMajor(tenge) },
        { account: '3310', side: 'CREDIT', amount: Money.ofMajor(tenge) },
      ],
      memo: 'оплата поставщику',
      analytics: { counterpartyBin: bin, counterpartyName: name, category: null },
      norm: null,
      legalParamsVersion: 'test',
      reversesEntryId: null,
    }),
  );
}

describe('список контрагентов компании (а)', () => {
  it('агрегирует сделки по БИН и подтягивает статус риска из реестра', async () => {
    const entries = [
      entry('201140000007', 'ТОО «Алматы Снаб»', 700_000),
      entry('201140000007', 'ТОО «Алматы Снаб»', 700_000),
      entry('180240000001', 'ТОО «Фантом Групп»', 500_000),
      entry(null, null, 99_000), // без контрагента — не попадает в список
    ];
    const list = await listCompanyCounterparties(entries, registry);
    expect(list).toHaveLength(2);

    // Рисковый — первым, несмотря на меньший оборот.
    expect(list[0]!.bin).toBe('180240000001');
    expect(list[0]!.verdict?.risky).toBe(true);
    expect(list[0]!.verdict?.norm).toContain('ст. 264');

    expect(list[1]!.deals).toBe(2);
    expect(list[1]!.totalAmount.toDecimalString()).toBe('1400000.00');
    expect(list[1]!.verdict?.risky).toBe(false);
  });

  it('контрагент вне реестра остаётся в списке со статусом «неизвестен»', async () => {
    const list = await listCompanyCounterparties([entry('120540000001', 'ТОО «Новый»', 10_000)], registry);
    expect(list).toHaveLength(1);
    expect(list[0]!.verdict).toBeNull();
  });
});

describe('точечная проверка по БИН (б)', () => {
  it('рисковый контрагент: вердикт с причиной и нормой', async () => {
    const result = unwrap(await checkCounterparty(registry, '180 240 000 001'));
    expect(result.kind).toBe('FOUND');
    if (result.kind !== 'FOUND') return;
    expect(result.verdict.risky).toBe(true);
    expect(result.verdict.critical).toBe(true);
    expect(result.verdict.reasons.join(' ')).toContain('лжепредприятием');
    expect(result.verdict.norm).toContain('ст. 264 НК РК');
  });

  it('надёжный контрагент: «без риска», нормы нет', async () => {
    const result = unwrap(await checkCounterparty(registry, '201140000007'));
    if (result.kind !== 'FOUND') throw new Error('ожидался FOUND');
    expect(result.verdict.risky).toBe(false);
    expect(result.verdict.reasons).toHaveLength(0);
    expect(result.verdict.norm).toBeNull();
  });

  it('неизвестный БИН — честное NOT_FOUND, кривой ввод — ошибка', async () => {
    const missing = unwrap(await checkCounterparty(registry, '120540000001'));
    expect(missing.kind).toBe('NOT_FOUND');
    const bad = await checkCounterparty(registry, 'абракадабра');
    expect(bad.ok).toBe(false);
  });
});
