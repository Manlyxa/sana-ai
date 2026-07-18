import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Обзор (§1): агрегат читает состояние модулей 2–5, ничего не считая сам. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('overview API', () => {
  it('пустой реестр → нули, но календарь уже знает сроки', async () => {
    const overview = await caller.overview();
    expect(overview.автопроводок).toBe(0);
    expect(overview.наПодтверждении).toBe(0);
    expect(overview.ближайшийСрок).not.toBeNull();
  });

  it('после ingestFixtures и runCheck обзор отражает реальное состояние модулей', async () => {
    await caller.accounting.ingestFixtures();
    await caller.runCheck();
    const overview = await caller.overview();

    // Автопроводки/очередь — состояние модуля 2–3.
    const queue = await caller.accounting.queue();
    expect(overview.наПодтверждении).toBe(queue.length);
    expect(overview.автопроводок).toBeGreaterThan(0);

    // Сумма под риском — сумма открытых находок Sana Guard.
    const feed = await caller.riskFeed();
    const total = feed.reduce((acc, f) => acc + BigInt(f.exposureTiyn), 0n);
    expect(overview.подРискомТиын).toBe(total.toString());
    expect(overview.открытыхРисков).toBe(feed.length);

    // Ближайший срок согласован с календарём (§9).
    const calendar = await caller.calendar.deadlines();
    const upcoming = calendar.сроки.find((d) => d.осталосьДней >= 0)!;
    expect(overview.ближайшийСрок?.дата).toBe(upcoming.дата);
  });

  it('подтверждение операции из очереди уменьшает счётчик обзора', async () => {
    const before = await caller.overview();
    const queue = await caller.accounting.queue();
    if (queue.length === 0) return;
    await caller.accounting.confirm({ pendingId: queue[0]!.id, confirmedBy: 'Айгерим' });
    const after = await caller.overview();
    expect(after.наПодтверждении).toBe(before.наПодтверждении - 1);
    expect(after.автопроводок).toBe(before.автопроводок + 1);
  });
});
