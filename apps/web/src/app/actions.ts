'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCaller } from '../lib/server';
import { STR } from '../lib/i18n/ru';

/** Server actions: единственный путь исполнения — через autonomy guard API (P6). */

export async function runCheckAction(): Promise<void> {
  const caller = await getCaller();
  await caller.runCheck();
  revalidatePath('/');
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
      // Клик по кнопке «Подтвердить и исполнить» — и есть подтверждение в приложении.
      await caller.remediate({
        findingId,
        confirmation: { confirmedBy: 'owner@demo.kz', atIso: new Date().toISOString() },
      });
    } else {
      // A1: система только ГОТОВИТ документ и запрашивает подпись (P4).
      notice = STR.signatureRequested;
    }
    if (autonomyLevel === 'A3' || autonomyLevel === 'A2') {
      await caller.runCheck(); // немедленная пересверка — решённый риск гаснет
    }
  } catch (e) {
    notice = e instanceof Error ? e.message : String(e);
  }

  revalidatePath('/');
  if (notice !== null) {
    redirect(`/?notice=${encodeURIComponent(notice)}`);
  }
}
