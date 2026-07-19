import Link from 'next/link';
import { getCaller } from '../../lib/server';
import { confirmOperationAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Автопроводки (§2–3): очередь подтверждения слева, деталь операции
 * справа — факт → проводка (посчитана кодом) → почему так решила.
 */
export default async function AutopostPage({
  searchParams,
}: {
  searchParams: Promise<{ op?: string; notice?: string }>;
}) {
  const caller = await getCaller();
  const [queue, overview] = await Promise.all([caller.accounting.queue(), caller.overview()]);
  const { op, notice } = await searchParams;

  const selected = queue.find((q) => q.id === op) ?? queue[0] ?? null;
  const nextAfterSelected =
    selected === null ? null : (queue.find((q) => q.id !== selected.id) ?? null);

  return (
    <section>
      <p className="page-sub">
        Sana провела {overview.автопроводок} операций сама. Эти отложила — не хватило уверенности.
      </p>

      {notice !== undefined && (
        <div className="mb-4 rounded-xl border border-teal-100 bg-teal-050 px-4 py-3 text-sm">{notice}</div>
      )}

      {queue.length === 0 ? (
        <div className="card py-10 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-green-050 text-xl text-green-700">
            ✓
          </div>
          <div className="text-[15px] font-semibold">Очередь пуста</div>
          <div className="mt-1 text-sm text-slate-mock">Sana проведёт следующие операции сама.</div>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr]">
          <div className="listcard lg:sticky lg:top-20">
            <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
              <h4 className="text-[13px] font-semibold">Очередь</h4>
              <span className="badge-teal">{queue.length}</span>
            </div>
            {queue.map((q) => {
              const isCredit = q.проводка.some((l) => l.счёт === '1030' && l.сторона === 'Дт');
              const amount = q.проводка[0]?.сумма.tenge ?? '0';
              return (
                <Link
                  key={q.id}
                  href={`/autopost?op=${encodeURIComponent(q.id)}`}
                  className={`flex items-start gap-2.5 border-b border-border-soft px-4 py-3 last:border-b-0 ${
                    selected?.id === q.id ? 'bg-teal-050 shadow-[inset_3px_0_0_#1FC8C0]' : 'hover:bg-paper'
                  }`}
                >
                  <div
                    className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-xs ${
                      isCredit ? 'bg-green-050 text-green-700' : 'bg-coral-050 text-red-600'
                    }`}
                  >
                    {isCredit ? '↑' : '↓'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{q.событие.тип}</div>
                    <div className="text-[11px] text-slate-light">
                      {q.событие.дата} · {q.событие.источник}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums">
                    {amount} ₸
                  </div>
                </Link>
              );
            })}
          </div>

          {selected !== null && (
            <div className="listcard">
              <div className="flex items-start justify-between gap-4 border-b border-border-soft px-5 py-4">
                <div>
                  <div className="text-[17px] font-semibold">{selected.событие.тип}</div>
                  <div className="mt-0.5 text-[12.5px] text-slate-mock">
                    {selected.событие.дата} · источник: {selected.событие.источник}
                  </div>
                </div>
                <span className="badge-amber">ждёт решения</span>
              </div>

              <div className="space-y-4 px-5 py-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-indigo-deep text-[10.5px] font-bold text-white">
                      1
                    </span>
                    <span className="text-[13px] font-semibold">Что пришло</span>
                    <span className="ml-auto rounded-full bg-teal-050 px-2 py-px text-[10px] font-semibold text-teal-700">
                      факт
                    </span>
                  </div>
                  <div className="field-box text-[12.5px]">
                    <div className="flex justify-between border-b border-dashed border-border-mock py-1">
                      <span className="text-slate-mock">Событие</span>
                      <span>{selected.событие.id}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-mock">Дата</span>
                      <span>{selected.событие.дата}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-indigo-deep text-[10.5px] font-bold text-white">
                      2
                    </span>
                    <span className="text-[13px] font-semibold">Проводка Sana</span>
                    <span className="ml-auto rounded-full bg-teal-050 px-2 py-px text-[10px] font-semibold text-teal-700">
                      рассчитано кодом
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-teal-100">
                    {selected.проводка.map((l, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-border-soft px-3.5 py-2.5 last:border-b-0"
                      >
                        <span
                          className={`rounded-md py-0.5 text-center text-[11px] font-bold ${
                            l.сторона === 'Дт'
                              ? 'bg-indigo-deep text-white'
                              : 'bg-teal-050 text-teal-700'
                          }`}
                        >
                          {l.сторона}
                        </span>
                        <span className="text-[12.5px]">
                          <b>{l.счёт}</b>
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums">{l.сумма.tenge} ₸</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-indigo-deep text-[10.5px] font-bold text-white">
                      3
                    </span>
                    <span className="text-[13px] font-semibold">Почему так решила</span>
                    <span className="ml-auto rounded-full bg-purple-050 px-2 py-px text-[10px] font-semibold text-purple-700">
                      уверенность {selected.confidence}%
                    </span>
                  </div>
                  <div className="rounded-xl border border-[#E6E1F7] bg-purple-050 px-3.5 py-3 text-[12.5px] leading-relaxed text-indigo-700d">
                    {selected.объяснение}
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 border-t border-border-soft bg-paper px-5 py-4">
                <form action={confirmOperationAction}>
                  <input type="hidden" name="pendingId" value={selected.id} />
                  <button type="submit" className="btn-green">
                    ✓ Подтвердить проводку
                  </button>
                </form>
                {nextAfterSelected !== null && (
                  <Link href={`/autopost?op=${encodeURIComponent(nextAfterSelected.id)}`} className="btn-ghost">
                    Пропустить
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
