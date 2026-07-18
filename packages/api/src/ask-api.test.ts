import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** «Спроси Sana» (§10) через tRPC. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('ask API', () => {
  it('вопрос о вычете — ответ с нормой', async () => {
    const answer = await caller.ask.question({ вопрос: 'Могу ли я списать аренду офиса?' });
    expect(answer.тип).toBe('ответ');
    if (answer.тип === 'ответ') expect(answer.норма).toContain('НК РК');
  });

  it('вопрос о сумме — направление к калькулятору, без самодельного расчёта', async () => {
    const answer = await caller.ask.question({ вопрос: 'Сколько пени набежало за просрочку?' });
    expect(answer.тип).toBe('калькулятор');
    if (answer.тип === 'калькулятор') {
      expect(answer.эндпоинт).toBe('calculators.penalty');
      expect(answer.текст).not.toMatch(/\d{2,}/);
    }
  });
});
