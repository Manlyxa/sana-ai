import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/**
 * Payroll API (§6) — вертикальный срез: фикстуры ведомости → доменный
 * движок (нарастающий ИПН) → подтверждение → начисление в реестр.
 */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('payroll API', () => {
  it('отдаёт ведомость июля: 7 сотрудников с расшифровкой и нормой', async () => {
    const sheet = await caller.payroll.sheet({ month: '2026-M07' });
    expect(sheet.месяц).toBe('2026-M07');
    expect(sheet.сводка.сотрудников).toBe(7);
    expect(sheet.сводка.проверено).toBe(0);
    expect(sheet.строки).toHaveLength(7);
    const line = sheet.строки.find((l) => l.должность === 'Кладовщик')!;
    expect(line.начислено.tenge).toBe('180000.00');
    expect(line.опв.tenge).toBe('18000.00');
    expect(line.ипн.tenge).toBe('15840.00');
    expect(line.норма).toContain('ст. 320');
    expect(line.версияПараметров).toContain('legal-params@');
  });

  it('подтверждение меняет статус строки; повторное — ошибка', async () => {
    const sheet = await caller.payroll.sheet({ month: '2026-M07' });
    const iin = sheet.строки[0]!.иин;
    const confirmed = await caller.payroll.confirm({ month: '2026-M07', iin, confirmedBy: 'Айгерим' });
    expect(confirmed.строка.статус).toBe('Проверено');
    await expect(
      caller.payroll.confirm({ month: '2026-M07', iin, confirmedBy: 'Айгерим' }),
    ).rejects.toThrow(/уже подтверждён/);
    const after = await caller.payroll.sheet({ month: '2026-M07' });
    expect(after.сводка.проверено).toBe(1);
  });

  it('«подтвердить все и начислить» проводит сбалансированную проводку в реестр', async () => {
    const accrued = await caller.payroll.confirmAllAndAccrue({ month: '2026-M07', confirmedBy: 'Айгерим' });
    expect(accrued.entryId).toBeTruthy();
    const debit = accrued.проводка
      .filter((l) => l.сторона === 'Дт')
      .reduce((sum, l) => sum + BigInt(l.сумма.tiyn), 0n);
    const credit = accrued.проводка
      .filter((l) => l.сторона === 'Кт')
      .reduce((sum, l) => sum + BigInt(l.сумма.tiyn), 0n);
    expect(debit).toBe(credit);
    expect(accrued.уже).toBe(false);

    // Повторное начисление того же месяца идемпотентно: не падает, а
    // сообщает «уже начислено» и возвращает ту же проводку (без дублей).
    const again = await caller.payroll.confirmAllAndAccrue({ month: '2026-M07', confirmedBy: 'Айгерим' });
    expect(again.уже).toBe(true);
    expect(again.entryId).toBe(accrued.entryId);
    expect(again.сообщение).toContain('уже начислена');
  });
});
