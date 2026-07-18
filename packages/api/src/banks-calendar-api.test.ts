import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Банковские счета (§13) и календарь сроков (§9) через tRPC. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('banks API', () => {
  it('Kaspi предподключён; «подключить» создаёт запись источника', async () => {
    const before = await caller.banks.list();
    expect(before.find((b) => b.id === 'kaspi')?.статус).toBe('Подключено');
    expect(before.filter((b) => b.статус === 'Подключено')).toHaveLength(1);

    const connected = await caller.banks.connect({ bankId: 'halyk' });
    expect(connected.банк).toBe('Halyk Bank');

    const after = await caller.banks.list();
    expect(after.filter((b) => b.статус === 'Подключено')).toHaveLength(2);

    await expect(caller.banks.connect({ bankId: 'halyk' })).rejects.toThrow(/уже подключён/);
    await expect(caller.banks.connect({ bankId: 'sberbank' })).rejects.toThrow(/не найден/);
  });

  it('выписки подключённых источников участвуют в автопроводках (§2)', async () => {
    const ingested = await caller.accounting.ingestFixtures();
    // Kaspi (фикстурная выписка) даёт события; пустой Halyk ничего не ломает.
    expect(ingested.events).toBeGreaterThan(0);
    expect(ingested.posted + ingested.queued).toBeGreaterThan(0);
  });
});

describe('calendar API', () => {
  it('сроки приходят из legal-params и кабинета НП, отсортированы по дате', async () => {
    const calendar = await caller.calendar.deadlines();
    expect(calendar.сроки.length).toBeGreaterThanOrEqual(3);

    const f910 = calendar.сроки.find((d) => d.название.includes('910.00'))!;
    // Полугодие 2026-H1 → срок 15 августа (ст. 728 НК РК), из legal-params.
    expect(f910.дата).toBe('2026-08-15');
    expect(f910.источник).toBe('legal-params');

    const dates = calendar.сроки.map((d) => d.дата);
    expect([...dates].sort()).toEqual(dates);

    // Уведомление КГД из фикстуры имеет дедлайн ответа в рабочих днях.
    const notice = calendar.сроки.find((d) => d.источник === 'уведомление КГД');
    expect(notice).toBeDefined();
  });
});
