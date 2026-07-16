import { appRouter, createDemoContext, type ApiContext } from '@sana/api';

/**
 * Серверный доступ к API: tRPC-caller в том же процессе (без HTTP-хопа),
 * типизирован насквозь. Контекст (PGlite + fixtures) — синглтон процесса.
 */

type Cached = {
  context: Promise<ApiContext>;
  firstRunDone: boolean;
};

const KEY = Symbol.for('sana.web.context');

function cached(): Cached {
  const globalStore = globalThis as unknown as Record<symbol, Cached | undefined>;
  let entry = globalStore[KEY];
  if (entry === undefined) {
    entry = { context: createDemoContext(), firstRunDone: false };
    globalStore[KEY] = entry;
  }
  return entry;
}

export async function getCaller() {
  const entry = cached();
  const ctx = await entry.context;
  return appRouter.createCaller(ctx);
}

/** Первый заход — сразу свежая проверка, чтобы лента не была пустой. */
export async function ensureFirstRun(): Promise<void> {
  const entry = cached();
  if (entry.firstRunDone) return;
  const caller = await getCaller();
  await caller.runCheck();
  entry.firstRunDone = true;
}
