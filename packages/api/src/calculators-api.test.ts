import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Калькуляторы (§11): та же логика, что в движке, через tRPC. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('calculators API', () => {
  it('ИПН: та же цифра, что показывает ведомость зарплаты для той же базы', async () => {
    const calc = await caller.calculators.ipn({
      доходСНачалаГодаТенге: 950_400, // база кладовщика за янв–июнь (6 × 158 400)
      начислениеМесяцаТенге: 158_400, // база июля
    });
    // Ведомость §6 показывает ИПН кладовщика 15 840 ₸ — калькулятор обязан совпасть.
    expect(calc.ипнМесяца.tenge).toBe('15840.00');
    expect(calc.норма).toContain('ст. 320');
  });

  it('порог НДС: параметры из legal-params, а не константы формы', async () => {
    const calc = await caller.calculators.vatThreshold({ оборотСНачалаГодаТенге: 34_800_000 });
    expect(calc.порог.tenge).toBe('43250000.00'); // 10 000 МРП × 4325
    expect(calc.осталосьДоПорога.tenge).toBe('8450000.00');
    expect(calc.порогПревышен).toBe(false);
    expect(calc.занятоПроцентов).toBe(80);
  });

  it('пеня: базовая ставка НБ × 1,25 × дни / 365', async () => {
    const calc = await caller.calculators.penalty({ суммаНалогаТенге: 1_044_000, днейПросрочки: 12 });
    expect(calc.пеня.tenge).toBe('7079.00');
    expect(calc.норма).toContain('1,25');
  });

  it('некорректный вход отвергается с человеческой ошибкой', async () => {
    await expect(
      caller.calculators.penalty({ суммаНалогаТенге: 1_000, днейПросрочки: -1 }),
    ).rejects.toThrow();
  });
});
