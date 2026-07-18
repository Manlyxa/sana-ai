import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { reconcile } from '@sana/domain';
import { parseReconCsv } from '@sana/app';
import type { ApiContext } from './context';

/**
 * Сверка данных (§12): один или два CSV-файла → построчное сопоставление →
 * список несовпадений человеческим языком (не технический дифф).
 */

const t = initTRPC.context<ApiContext>().create();

const fileInput = z.object({ name: z.string().min(1), csv: z.string().min(1) });

export const reconciliationRouter = t.router({
  run: t.procedure
    .input(z.object({ файлА: fileInput, файлБ: fileInput.nullish() }))
    .mutation(({ input }) => {
      const left = parseReconCsv(input.файлА.csv);
      if (!left.ok) {
        return {
          успех: false as const,
          сообщение: `Файл «${input.файлА.name}» не разобран.`,
          ошибки: left.error.map((e) => ({ строка: e.row, сообщение: e.message })),
        };
      }
      let rightRows = null;
      if (input.файлБ != null) {
        const right = parseReconCsv(input.файлБ.csv);
        if (!right.ok) {
          return {
            успех: false as const,
            сообщение: `Файл «${input.файлБ.name}» не разобран.`,
            ошибки: right.error.map((e) => ({ строка: e.row, сообщение: e.message })),
          };
        }
        rightRows = right.value;
      }
      const report = reconcile(
        { name: input.файлА.name, rows: left.value },
        rightRows === null || input.файлБ == null ? null : { name: input.файлБ.name, rows: rightRows },
      );
      if (report.rowsCompared === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'в файлах нет строк для сверки' });
      }
      return {
        успех: true as const,
        сообщение:
          report.mismatches.length === 0
            ? `Все ${report.rowsCompared} строк совпали без замечаний.`
            : `Найдено ${report.mismatches.length} несовпадений из ${report.rowsCompared} строк; ` +
              `${report.rowsMatched} совпали без замечаний.`,
        строкПроверено: report.rowsCompared,
        строкСовпало: report.rowsMatched,
        несовпадения: report.mismatches.map((m) => ({
          тип: m.kind,
          заголовок: m.title,
          объяснение: m.detail,
          действие: m.action === 'CHECK' ? ('Проверить' as const) : ('Уточнить' as const),
        })),
      };
    }),
});
