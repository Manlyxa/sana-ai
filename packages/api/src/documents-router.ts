import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { intakeDocumentFile } from '@sana/app';
import { accountingWorkspace } from './accounting-router';
import type { ApiContext } from './context';

/**
 * Документы (§8): загрузка файла → фикстурный OCR → запись в ТОЙ ЖЕ
 * очереди подтверждения, что и автопроводки. Подтверждение — через
 * accounting.confirm: отдельного UI-состояния у документов нет.
 */

const t = initTRPC.context<ApiContext>().create();

export const documentsRouter = t.router({
  upload: t.procedure.input(z.object({ fileName: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const result = await intakeDocumentFile(await accountingWorkspace(ctx), ctx.ocr, {
      fileName: input.fileName,
      today: ctx.today,
    });
    if (!result.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message });
    const { recognized, pending } = result.value;
    return {
      сообщение: `«${recognized.title}» распознан и поставлен в очередь подтверждения.`,
      pendingId: pending.id,
      распознано: {
        название: recognized.title,
        типДокумента: recognized.documentType,
        дата: recognized.date.toISO(),
        сумма: { tiyn: recognized.amount.amount.toString(), tenge: recognized.amount.toDecimalString() },
        уверенность: recognized.confidence,
      },
      предложение: {
        confidence: pending.proposal.confidence,
        объяснение: pending.proposal.explanation,
        проводка: pending.proposal.lines.map((l) => ({
          счёт: l.account,
          сторона: l.side === 'DEBIT' ? 'Дт' : 'Кт',
          сумма: { tiyn: l.amount.amount.toString(), tenge: l.amount.toDecimalString() },
        })),
      },
    };
  }),
});
