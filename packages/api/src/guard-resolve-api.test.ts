import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/**
 * Sana Guard (§3): «решено» — реальный use-case, меняющий статус находки
 * в реестре, а не тумблер в интерфейсе.
 */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
  await caller.runCheck();
});

describe('resolveFinding', () => {
  it('находка исчезает из ленты после «решено» и не решается повторно', async () => {
    const before = await caller.riskFeed();
    expect(before.length).toBeGreaterThan(0);
    const target = before[0]!;
    // Каждая находка несёт сумму риска и норму НК (§3а).
    expect(BigInt(target.exposureTiyn) >= 0n).toBe(true);
    expect(target.norm.length).toBeGreaterThan(3);

    const resolved = await caller.resolveFinding({
      findingId: target.id,
      resolvedBy: 'Айгерим',
      note: 'вопрос закрыт документами',
    });
    expect(resolved.findingId).toBe(target.id);

    const after = await caller.riskFeed();
    expect(after.find((f) => f.id === target.id)).toBeUndefined();
    expect(after.length).toBe(before.length - 1);

    await expect(
      caller.resolveFinding({ findingId: target.id, resolvedBy: 'Айгерим' }),
    ).rejects.toThrow(/уже решена|не найдена/);
  });
});
