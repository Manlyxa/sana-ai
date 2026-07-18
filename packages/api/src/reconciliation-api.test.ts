import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Сверка (§12) через tRPC: человеческий отчёт, диагностика мусора. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('reconciliation API', () => {
  it('находит ровно три сконструированных несовпадения', async () => {
    const result = await caller.reconciliation.run({
      файлА: {
        name: 'сводная',
        csv: 'Дата;Сумма;Контрагент\n2026-07-03;84500;Каспий Строй\n2026-07-07;250000;Оплата\n2026-07-07;250000;Оплата\n2026-07-12;65000;ИП Абенов',
      },
      файлБ: {
        name: 'журнал',
        csv: 'Дата;Сумма;Контрагент\n2026-07-03;84000;Каспий Строй\n2026-07-07;250000;Оплата\n;65000;ИП Абенов',
      },
    });
    expect(result.успех).toBe(true);
    if (!result.успех) return;
    expect(result.несовпадения).toHaveLength(3);
    expect(result.несовпадения.map((m) => m.действие)).toContain('Уточнить');
  });

  it('нечитаемый файл — отказ с диагностикой по строкам', async () => {
    const result = await caller.reconciliation.run({
      файлА: { name: 'битый', csv: 'Дата;Сумма;Контрагент\n2026-07-01;не число;X' },
    });
    expect(result.успех).toBe(false);
    if (result.успех) return;
    expect(result.ошибки[0]!.строка).toBe(2);
  });
});
