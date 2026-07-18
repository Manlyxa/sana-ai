import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Контрагенты (§7): список из проводок реестра + точечная проверка по БИН. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
  await caller.accounting.ingestFixtures();
});

describe('counterparties API', () => {
  it('список строится из проводок реестра, а не из статического массива', async () => {
    const list = await caller.counterparties.list();
    expect(list.length).toBeGreaterThan(0);
    for (const cp of list) {
      expect(cp.сделок).toBeGreaterThan(0);
      expect(BigInt(cp.оборот.tiyn)).toBeGreaterThan(0n);
    }
  });

  it('проверка рискового БИН: карточка с причиной и нормой; попадает в историю', async () => {
    const result = await caller.counterparties.check({ bin: '180240000001' });
    expect(result.найден).toBe(true);
    if (!result.найден) return;
    expect(result.карточка.вердикт).toBe('Есть риск');
    expect(result.карточка.причины.join(' ')).toContain('лжепредприятием');
    expect(result.карточка.норма).toContain('ст. 264');

    const clean = await caller.counterparties.check({ bin: '201 140 000 007' });
    if (!clean.найден) throw new Error('ожидался найденный контрагент');
    expect(clean.карточка.вердикт).toBe('Без риска');
    expect(clean.карточка.норма).toBeNull();

    const historyList = await caller.counterparties.checkHistory();
    expect(historyList).toHaveLength(2);
    expect(historyList[0]!.наименование).toContain('Алматы Снаб');
  });

  it('неизвестный БИН — явное «не найден», мусорный ввод — ошибка', async () => {
    const missing = await caller.counterparties.check({ bin: '120540000001' });
    expect(missing.найден).toBe(false);
    await expect(caller.counterparties.check({ bin: 'мусор' })).rejects.toThrow(/не похоже на БИН/);
  });
});
