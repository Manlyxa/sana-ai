import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';

/** Документы (§8): загрузка → общая очередь → подтверждение тем же use-case. */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('documents API', () => {
  it('загрузка попадает в общую очередь и подтверждается accounting.confirm', async () => {
    const uploaded = await caller.documents.upload({ fileName: 'скан-такси.jpg' });
    expect(uploaded.распознано.уверенность).toBe(81);

    const queue = await caller.accounting.queue();
    const inQueue = queue.find((q) => q.id === uploaded.pendingId);
    expect(inQueue).toBeDefined();
    expect(inQueue!.confidence).toBe(81);

    const confirmed = await caller.accounting.confirm({
      pendingId: uploaded.pendingId,
      confirmedBy: 'Айгерим',
    });
    expect(confirmed.entryId).toBeTruthy();
    const after = await caller.accounting.queue();
    expect(after.find((q) => q.id === uploaded.pendingId)).toBeUndefined();
  });

  it('нераспознанный файл — понятная ошибка', async () => {
    await expect(caller.documents.upload({ fileName: 'фото-кота.jpg' })).rejects.toThrow(/не распознан/);
  });
});
