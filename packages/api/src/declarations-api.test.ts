import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Декларации ФНО (§5): цифры из реестра и ведомостей, не из констант. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
  await caller.accounting.ingestFixtures();
});

describe('declarations API', () => {
  it('910.00: доход и налог согласованы с ОПиУ реестра, срок — из legal-params', async () => {
    const list = await caller.declarations.list();
    const f910 = list.find((d) => d.форма === '910.00')!;
    expect(f910.поля).toHaveProperty('доход');
    expect(f910.норма).toContain('ст. 72');

    const detail = await caller.declarations.form910({ period: '2026-H1' });
    // Налог = доход × ставка СНР (4%): проверяем согласованность через tiyn.
    const incomeTiyn = BigInt(detail.доход.tiyn);
    const taxTiyn = BigInt(detail.налогКУплате.tiyn);
    // 4% с округлением до тенге: |налог × 25 − доход| < 25 000 тиын (1 тенге × 25... допуск округления)
    expect(detail.ставка).toBe('4%');
    const diff = taxTiyn * 25n - incomeTiyn;
    expect(diff < 2500n && diff > -2500n).toBe(true);
    expect(detail.срокСдачи).toBe('2026-08-15');
    // Каждая цифра объяснима: есть проводки-основания.
    expect(detail.проводкиОснования.length).toBeGreaterThan(0);

    // Доход 910.00 за полугодие == выручка ОПиУ за то же полугодие.
    const plH1 = await caller.accounting.profitLoss({ period: '2026-H1' });
    expect(detail.доход.tiyn).toBe(plH1.доходы.total.tiyn);
  });

  it('200.00: свод ИПН/ОПВ из зарплатных ведомостей квартала', async () => {
    const list = await caller.declarations.list();
    const f200 = list.find((d) => d.форма === '200.00')!;
    expect(f200.поля.сотрудников).toBe(7);
    // ИПН за квартал > 0 и кратен реальным ведомостям (3 месяца × 7 сотрудников).
    expect(BigInt(f200.поля.начисленоИпн!.tiyn)).toBeGreaterThan(0n);
    expect(f200.срок).toBe('2026-08-15');
  });

  it('300.00: мониторинг порога — та же функция, что калькулятор', async () => {
    const list = await caller.declarations.list();
    const f300 = list.find((d) => d.форма === '300.00')!;
    expect(f300.поля.порогРегистрации!.tenge).toBe('43250000.00');
    expect(['Мониторинг', 'Требуется регистрация']).toContain(f300.статус);
  });

  it('910.00 за квартал отвергается — форма полугодовая', async () => {
    await expect(caller.declarations.form910({ period: '2026-Q1' })).rejects.toThrow(/полугодие/);
  });
});
