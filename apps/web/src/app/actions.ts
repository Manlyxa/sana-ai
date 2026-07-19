'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getCaller,
  pushChat,
  setLastCpCheck,
  setLastImport,
  setLastRecon,
} from '../lib/server';
import { STR } from '../lib/i18n/ru';

/**
 * Server actions — единственный путь мутаций из веба. Каждая кнопка
 * дергает реальный use-case через tRPC-caller; никакой логики здесь нет.
 */

const OWNER = 'Айгерим Т.';

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- Sana Guard ------------------------------------------------------------

export async function runCheckAction(): Promise<void> {
  const caller = await getCaller();
  await caller.runCheck();
  revalidatePath('/', 'layout');
}

export async function resolveFindingAction(formData: FormData): Promise<void> {
  const findingId = String(formData.get('findingId') ?? '');
  const caller = await getCaller();
  try {
    await caller.resolveFinding({ findingId, resolvedBy: OWNER, note: 'закрыто владельцем из ленты' });
  } catch {
    // Уже решена — лента просто обновится.
  }
  revalidatePath('/', 'layout');
}

export async function remediateAction(formData: FormData): Promise<void> {
  const findingId = String(formData.get('findingId') ?? '');
  const autonomyLevel = String(formData.get('autonomyLevel') ?? '');
  const caller = await getCaller();

  let notice: string | null = null;
  try {
    if (autonomyLevel === 'A3') {
      await caller.remediate({ findingId });
    } else if (autonomyLevel === 'A2') {
      await caller.remediate({
        findingId,
        confirmation: { confirmedBy: 'owner@demo.kz', atIso: new Date().toISOString() },
      });
    } else {
      notice = STR.signatureRequested;
    }
    if (autonomyLevel === 'A3' || autonomyLevel === 'A2') {
      await caller.runCheck();
    }
  } catch (e) {
    notice = message(e);
  }

  revalidatePath('/', 'layout');
  if (notice !== null) {
    redirect(`/guard?notice=${encodeURIComponent(notice)}`);
  }
}

// --- Автопроводки (§2–3) ---------------------------------------------------

export async function confirmOperationAction(formData: FormData): Promise<void> {
  const pendingId = String(formData.get('pendingId') ?? '');
  const caller = await getCaller();
  try {
    await caller.accounting.confirm({ pendingId, confirmedBy: OWNER });
  } catch (e) {
    revalidatePath('/', 'layout');
    redirect(`/autopost?notice=${encodeURIComponent(message(e))}`);
  }
  revalidatePath('/', 'layout');
  redirect('/autopost');
}

// --- Отчётность (§4) -------------------------------------------------------

const DEMO_JOURNAL_CSV = [
  'Дата;Счёт Дт;Счёт Кт;Сумма;Описание;Операция',
  '2026-04-02;1030;6010;2500000;Оплата за оказанные услуги;',
  '2026-04-05;7210;1030;350000;Аренда офиса за апрель;',
  '2026-04-12;1330;3310;1200000;Закуп товара у поставщика;',
  '2026-04-15;3310;1030;1200000;Оплата поставщику по договору №44;',
  '2026-04-25;7110;1030;180000;Доставка товара покупателям;',
].join('\n');

export async function importJournalAction(formData: FormData): Promise<void> {
  const raw = String(formData.get('csv') ?? '').trim();
  const csv = raw === '' ? DEMO_JOURNAL_CSV : raw;
  const fileName = raw === '' ? 'демо-проводки_апрель.csv' : 'загруженный-файл.csv';
  const caller = await getCaller();
  const result = await caller.accounting.importJournal({ csv, fileName });
  setLastImport(
    result.успех
      ? { ok: true, сообщение: result.сообщение }
      : { ok: false, сообщение: result.сообщение, ошибки: result.ошибки },
  );
  revalidatePath('/', 'layout');
  redirect('/reports');
}

// --- Зарплата (§6) ---------------------------------------------------------

export async function payrollConfirmAction(formData: FormData): Promise<void> {
  const iin = String(formData.get('iin') ?? '');
  const caller = await getCaller();
  try {
    await caller.payroll.confirm({ month: '2026-M07', iin, confirmedBy: OWNER });
  } catch {
    // Уже подтверждён — просто обновляем.
  }
  revalidatePath('/payroll');
}

export async function payrollAccrueAllAction(): Promise<void> {
  const caller = await getCaller();
  try {
    await caller.payroll.confirmAllAndAccrue({ month: '2026-M07', confirmedBy: OWNER });
  } catch (e) {
    revalidatePath('/', 'layout');
    redirect(`/payroll?notice=${encodeURIComponent(message(e))}`);
  }
  revalidatePath('/', 'layout');
  redirect('/payroll?notice=' + encodeURIComponent('Начислено за 2026-M07 — проводка в реестре.'));
}

// --- Банки (§13) -----------------------------------------------------------

export async function connectBankAction(formData: FormData): Promise<void> {
  const bankId = String(formData.get('bankId') ?? '');
  const caller = await getCaller();
  try {
    await caller.banks.connect({ bankId });
    // Новый источник сразу участвует в автопроводках (идемпотентно).
    await caller.accounting.ingestFixtures();
  } catch (e) {
    revalidatePath('/', 'layout');
    redirect(`/banks?notice=${encodeURIComponent(message(e))}`);
  }
  revalidatePath('/', 'layout');
}

// --- Документы (§8) --------------------------------------------------------

export async function uploadDocAction(formData: FormData): Promise<void> {
  const fileName = String(formData.get('fileName') ?? '');
  const caller = await getCaller();
  try {
    await caller.documents.upload({ fileName });
  } catch (e) {
    revalidatePath('/', 'layout');
    redirect(`/documents?notice=${encodeURIComponent(message(e))}`);
  }
  revalidatePath('/', 'layout');
}

// --- Проверка контрагента (§7б) --------------------------------------------

export async function cpCheckAction(formData: FormData): Promise<void> {
  const bin = String(formData.get('bin') ?? '').trim();
  const caller = await getCaller();
  try {
    const result = await caller.counterparties.check({ bin });
    if (result.найден) {
      setLastCpCheck({
        kind: 'FOUND',
        бин: result.карточка.бин,
        наименование: result.карточка.наименование,
        вердикт: result.карточка.вердикт,
        причины: result.карточка.причины,
        норма: result.карточка.норма,
      });
    } else {
      setLastCpCheck({ kind: 'NOT_FOUND', сообщение: result.сообщение });
    }
  } catch (e) {
    setLastCpCheck({ kind: 'ERROR', сообщение: message(e) });
  }
  revalidatePath('/cpcheck');
  redirect('/cpcheck');
}

// --- Сверка (§12) ----------------------------------------------------------

export async function reconcileAction(formData: FormData): Promise<void> {
  const csvA = String(formData.get('csvA') ?? '').trim();
  const csvB = String(formData.get('csvB') ?? '').trim();
  const caller = await getCaller();
  try {
    const result = await caller.reconciliation.run({
      файлА: { name: 'сводная таблица', csv: csvA },
      файлБ: csvB === '' ? null : { name: 'журнал проводок', csv: csvB },
    });
    setLastRecon(
      result.успех
        ? {
            ok: true,
            сообщение: result.сообщение,
            строкПроверено: result.строкПроверено,
            строкСовпало: result.строкСовпало,
            несовпадения: result.несовпадения,
          }
        : { ok: false, сообщение: result.сообщение, ошибки: result.ошибки },
    );
  } catch (e) {
    setLastRecon({ ok: false, сообщение: message(e), ошибки: [] });
  }
  revalidatePath('/reconcile');
  redirect('/reconcile');
}

// --- Спроси Sana (§10) -----------------------------------------------------

export async function askAction(formData: FormData): Promise<void> {
  const question = String(formData.get('question') ?? '').trim();
  if (question === '') redirect('/ask');
  pushChat({ role: 'user', text: question, cite: null });
  const caller = await getCaller();
  try {
    const answer = await caller.ask.question({ вопрос: question });
    if (answer.тип === 'ответ') {
      pushChat({ role: 'sana', text: answer.текст, cite: answer.норма });
    } else if (answer.тип === 'калькулятор') {
      pushChat({
        role: 'sana',
        text: `${answer.текст} Откройте «Калькуляторы» → вкладка «${answer.калькулятор}».`,
        cite: answer.норма,
      });
    } else {
      pushChat({ role: 'sana', text: answer.текст, cite: null });
    }
  } catch (e) {
    pushChat({ role: 'sana', text: `Не получилось ответить: ${message(e)}`, cite: null });
  }
  revalidatePath('/ask');
  redirect('/ask');
}
