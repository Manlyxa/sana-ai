import Link from 'next/link';
import { getCaller } from '../../lib/server';
import { uploadDocAction } from '../actions';

export const dynamic = 'force-dynamic';

const DEMO_DOCS = [
  { fileName: 'скан-такси-отчёт.jpg', title: 'Авансовый отчёт — такси' },
  { fileName: 'чек-канцтовары.pdf', title: 'Чек ОФД — канцтовары' },
  { fileName: 'акт-выполненных-работ-12.pdf', title: 'Акт выполненных работ №12' },
];

/**
 * Документы (§8): скан → фикстурный OCR → НАСТОЯЩАЯ запись в той же
 * очереди подтверждения, что и автопроводки. Подтверждение — там же.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const caller = await getCaller();
  const queue = await caller.accounting.queue();
  const { notice } = await searchParams;
  const docItems = queue.filter((q) => q.событие.источник === 'РУЧНОЙ_ВВОД');

  return (
    <section>
      <p className="page-sub">
        Сфотографируйте акт, чек или авансовый отчёт — Sana распознает и предложит проводку.
        Распознанный документ встаёт в общую очередь подтверждения.
      </p>

      {notice !== undefined && (
        <div className="mb-4 rounded-xl border border-coral-050 bg-coral-050 px-4 py-3 text-sm text-red-700">
          {notice}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {DEMO_DOCS.map((doc) => (
          <form key={doc.fileName} action={uploadDocAction} className="card text-center">
            <input type="hidden" name="fileName" value={doc.fileName} />
            <div className="mx-auto mb-2.5 grid h-11 w-11 place-items-center rounded-xl bg-paper text-lg">
              📄
            </div>
            <div className="text-[13px] font-semibold">{doc.title}</div>
            <div className="mb-3 mt-0.5 text-[11px] text-slate-light">{doc.fileName}</div>
            <button type="submit" className="btn-primary !px-3.5 !py-1.5 text-[12px]">
              Загрузить демо-скан
            </button>
          </form>
        ))}
      </div>

      <div className="section-h">
        Распознанные документы в очереди{' '}
        <span className="tag-sm">подтверждаются там же, где автопроводки</span>
      </div>
      <div className="listcard">
        {docItems.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-mock">
            Загруженных документов в очереди нет — загрузите демо-скан выше.
          </div>
        ) : (
          docItems.map((d) => (
            <div key={d.id} className="row">
              <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-teal-050 text-sm text-teal-700">
                📄
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{d.объяснение}</div>
                <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-light">
                  распознано · уверенность {d.confidence}%
                  <span className="inline-block h-[5px] w-[60px] overflow-hidden rounded bg-border-soft">
                    <span className="block h-full bg-teal" style={{ width: `${d.confidence}%` }} />
                  </span>
                </div>
              </div>
              <Link
                href={`/autopost?op=${encodeURIComponent(d.id)}`}
                className="btn-green !px-3 !py-1.5 text-[11.5px]"
              >
                В очередь проводок →
              </Link>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
