import { beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDb, type Db } from '@sana/db';
import { appRouter } from './router';
import { createDemoContext } from './context';

/**
 * Персистентность главной книги: проводки должны переживать пересоздание
 * контекста на той же БД (эмуляция рестарта процесса). Раньше реестр жил
 * только в памяти WeakMap и терялся при рестарте — это закрывает разрыв.
 */

let db: Db;

beforeAll(async () => {
  // Одна общая БД для двух «жизней» контекста.
  db = await createInMemoryDb();
});

describe('персистентность реестра между контекстами (одна БД)', () => {
  it('проводки, созданные в первом контексте, видны во втором', async () => {
    // Жизнь 1: ingest + подтверждение → проводки в БД.
    const ctx1 = await createDemoContext(db, { llm: null });
    const caller1 = appRouter.createCaller(ctx1);
    const ingested = await caller1.accounting.ingestFixtures();
    expect(ingested.posted).toBeGreaterThan(0);

    // Подтвердим одну операцию из очереди — ещё одна проводка в реестр.
    const queue1 = await caller1.accounting.queue();
    if (queue1.length > 0) {
      await caller1.accounting.confirm({ pendingId: queue1[0]!.id, confirmedBy: 'Айгерим' });
    }
    const overview1 = await caller1.overview();
    const entriesAfterLife1 = overview1.автопроводок;
    expect(entriesAfterLife1).toBeGreaterThan(0);

    // Жизнь 2: НОВЫЙ контекст на той же БД (WeakMap-кэш workspace пуст).
    const ctx2 = await createDemoContext(db, { llm: null });
    const caller2 = appRouter.createCaller(ctx2);
    const overview2 = await caller2.overview();

    // Реестр гидратирован из БД — количество проводок совпадает.
    expect(overview2.автопроводок).toBe(entriesAfterLife1);

    // И отчёты во второй жизни строятся на восстановленных проводках.
    const bs = await caller2.accounting.balanceSheet({ asOf: '2026-05-10' });
    expect(bs.балансСходится).toBe(true);
  });

  it('повторная гидратация не задваивает проводки (append-only идемпотентен)', async () => {
    const ctx3 = await createDemoContext(db, { llm: null });
    const caller3 = appRouter.createCaller(ctx3);
    const before = (await caller3.overview()).автопроводок;

    // Повторный ingest тех же фикстур не создаёт дублей (id детерминированы).
    await caller3.accounting.ingestFixtures();
    const after = (await caller3.overview()).автопроводок;
    expect(after).toBe(before);
  });
});
