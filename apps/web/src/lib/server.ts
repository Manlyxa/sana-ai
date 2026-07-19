import { appRouter, createDemoContext, type ApiContext } from '@sana/api';

/**
 * Серверный доступ к API: tRPC-caller в том же процессе (без HTTP-хопа),
 * типизирован насквозь. Контекст (PGlite + fixtures) — синглтон процесса.
 */

export type ChatMessage = {
  readonly role: 'user' | 'sana';
  readonly text: string;
  readonly cite: string | null;
};

export type ReconReportUi =
  | {
      readonly ok: true;
      readonly сообщение: string;
      readonly строкПроверено: number;
      readonly строкСовпало: number;
      readonly несовпадения: ReadonlyArray<{
        readonly тип: string;
        readonly заголовок: string;
        readonly объяснение: string;
        readonly действие: 'Проверить' | 'Уточнить';
      }>;
    }
  | {
      readonly ok: false;
      readonly сообщение: string;
      readonly ошибки: ReadonlyArray<{ readonly строка: number | null; readonly сообщение: string }>;
    };

export type CpCheckUi =
  | {
      readonly kind: 'FOUND';
      readonly бин: string;
      readonly наименование: string;
      readonly вердикт: 'Есть риск' | 'Без риска';
      readonly причины: readonly string[];
      readonly норма: string | null;
    }
  | { readonly kind: 'NOT_FOUND'; readonly сообщение: string }
  | { readonly kind: 'ERROR'; readonly сообщение: string };

type Cached = {
  context: Promise<ApiContext>;
  firstRunDone: boolean;
  /** UI-состояние демо-сеанса (один пользователь на процесс). */
  chatLog: ChatMessage[];
  lastRecon: ReconReportUi | null;
  lastCpCheck: CpCheckUi | null;
};

const KEY = Symbol.for('sana.web.context');

function cached(): Cached {
  const globalStore = globalThis as unknown as Record<symbol, Cached | undefined>;
  let entry = globalStore[KEY];
  if (entry === undefined) {
    entry = {
      context: createDemoContext(),
      firstRunDone: false,
      chatLog: [],
      lastRecon: null,
      lastCpCheck: null,
    };
    globalStore[KEY] = entry;
  }
  return entry;
}

export async function getCaller() {
  const entry = cached();
  const ctx = await entry.context;
  return appRouter.createCaller(ctx);
}

/**
 * Первый заход: свежая комплаенс-проверка + фикстурные события в реестр
 * (идемпотентно), чтобы все экраны сразу были на настоящих данных.
 */
export async function ensureFirstRun(): Promise<void> {
  const entry = cached();
  if (entry.firstRunDone) return;
  const caller = await getCaller();
  await caller.runCheck();
  await caller.accounting.ingestFixtures();
  entry.firstRunDone = true;
}

/** Чат «Спроси Sana» — состояние демо-сеанса. */
export function chatLog(): readonly ChatMessage[] {
  return cached().chatLog;
}

export function pushChat(message: ChatMessage): void {
  cached().chatLog.push(message);
}

/** Последний отчёт сверки (§12). */
export function lastRecon(): ReconReportUi | null {
  return cached().lastRecon;
}

export function setLastRecon(report: ReconReportUi): void {
  cached().lastRecon = report;
}

/** Последняя проверка контрагента (§7б). */
export function lastCpCheck(): CpCheckUi | null {
  return cached().lastCpCheck;
}

export function setLastCpCheck(result: CpCheckUi): void {
  cached().lastCpCheck = result;
}

export type ImportUi =
  | { readonly ok: true; readonly сообщение: string }
  | {
      readonly ok: false;
      readonly сообщение: string;
      readonly ошибки: ReadonlyArray<{ readonly строка: number | null; readonly сообщение: string }>;
    };

const importKey = Symbol.for('sana.web.lastImport');

/** Итог последнего импорта журнала (§4). */
export function lastImport(): ImportUi | null {
  const store = globalThis as unknown as Record<symbol, ImportUi | null | undefined>;
  return store[importKey] ?? null;
}

export function setLastImport(result: ImportUi): void {
  const store = globalThis as unknown as Record<symbol, ImportUi | null | undefined>;
  store[importKey] = result;
}
