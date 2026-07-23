import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/**
 * Accounting API (Modules 1–5) — the full vertical slice through tRPC:
 * fixtures → posting engine → queue → reports → «объясни цифру».
 */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('accounting API', () => {
  it('ingests fixture events: auto-posts and queues', async () => {
    const result = await caller.accounting.ingestFixtures();
    expect(result.events).toBeGreaterThan(0);
    expect(result.posted).toBeGreaterThan(0);
    expect(result.сообщение).toContain('Обработано событий');
  });

  it('serves the confirmation queue and resolves items', async () => {
    const queue = await caller.accounting.queue();
    if (queue.length === 0) return; // все события оказались однозначными
    const first = queue[0]!;
    expect(first.confidence).toBeLessThan(90);
    expect(first.объяснение.length).toBeGreaterThan(5);
    const confirmed = await caller.accounting.confirm({ pendingId: first.id, confirmedBy: 'owner@demo' });
    expect(confirmed.entryId).toBeTruthy();
  });

  it('produces а balanced ОСВ and consistent reports', async () => {
    const tb = await caller.accounting.trialBalance({ period: '2026-Q1' });
    expect(tb.сбалансирована).toBe(true);
    const bs = await caller.accounting.balanceSheet({ asOf: '2026-03-31' });
    expect(bs.балансСходится).toBe(true);
    const pl = await caller.accounting.profitLoss({ period: '2026-Q1' });
    expect(pl.доходы.lines.length).toBeGreaterThan(0);
    const cf = await caller.accounting.cashFlow({ period: '2026-Q1' });
    expect(cf.сходится).toBe(true);
  });

  it('imports a CSV journal and rejects unbalanced files with diagnostics', async () => {
    const good = await caller.accounting.importJournal({
      csv: ['Дата;Дт;Кт;Сумма;Описание', '2026-04-01;1030;5030;500000;Взнос в капитал'].join('\n'),
      fileName: 'q2.csv',
    });
    expect(good.успех).toBe(true);

    const bad = await caller.accounting.importJournal({
      csv: [
        'Дата;Дт;Кт;Сумма;Описание;Операция',
        '2026-04-01;1210;;100;Продажа;оп-1',
        '2026-04-01;;6010;90;Продажа;оп-1',
      ].join('\n'),
      fileName: 'bad.csv',
    });
    expect(bad.успех).toBe(false);
    if (!bad.успех) {
      expect(bad.ошибки[0]?.сообщение).toContain('не сбалансирована');
    }
  });

  it('повторный импорт того же файла идемпотентен: дубли пропускаются, не падает', async () => {
    const csv = ['Дата;Дт;Кт;Сумма;Описание', '2026-04-03;1030;5030;700000;Взнос'].join('\n');
    const first = await caller.accounting.importJournal({ csv, fileName: 'reimport.csv' });
    expect(first.успех).toBe(true);
    if (first.успех) {
      expect(first.добавлено).toBe(1);
      expect(first.ужеБыло).toBe(0);
    }
    const second = await caller.accounting.importJournal({ csv, fileName: 'reimport.csv' });
    expect(second.успех).toBe(true);
    if (second.успех) {
      expect(second.добавлено).toBe(0);
      expect(second.ужеБыло).toBe(1);
      expect(second.сообщение).toContain('уже были в реестре');
    }
  });

  it('explains a journal entry and a report line end-to-end', async () => {
    const tb = await caller.accounting.trialBalance({ period: '2026' });
    const entryId = tb.строки.find((r) => r.entryIds.length > 0)?.entryIds[0];
    expect(entryId).toBeTruthy();
    const entry = await caller.accounting.explain({ ledgerEntryId: entryId! });
    expect(entry.факт.length).toBeGreaterThan(10);
    expect(entry.ссылки.sourceEventIds.length).toBe(1);

    const line = await caller.accounting.explain({ reportLineId: 'bs:assets:1030', period: '2026' });
    expect(line.правило).toContain('Активы = Обязательства + Капитал');
    expect(line.ссылки.entryIds.length).toBeGreaterThan(0);
  });

  it('closes a period and rejects postings into it', async () => {
    const closed = await caller.accounting.closePeriod({ period: '2026-M01' });
    expect(closed.сообщение).toContain('закрыт');
    // Импорт валиден сам по себе, но книга отклоняет проводку в закрытый период.
    await expect(
      caller.accounting.importJournal({
        csv: ['Дата;Дт;Кт;Сумма;Описание', '2026-01-20;1030;5030;1;Задним числом'].join('\n'),
        fileName: 'late.csv',
      }),
    ).rejects.toThrow(/закрыт/);
  });
});
