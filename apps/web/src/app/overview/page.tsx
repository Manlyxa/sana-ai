import Link from 'next/link';
import { ensureFirstRun, getCaller } from '../../lib/server';

export const dynamic = 'force-dynamic';

/**
 * Обзор (§1): агрегирующий экран поверх модулей 2–5. Ничего не считает —
 * читает готовое состояние через overview + соседние use-case.
 */
export default async function OverviewPage() {
  await ensureFirstRun();
  const caller = await getCaller();
  // Наполняем реестр фикстурными событиями один раз за процесс.
  const overviewBefore = await caller.overview();
  if (overviewBefore.автопроводок === 0 && overviewBefore.наПодтверждении === 0) {
    await caller.accounting.ingestFixtures();
  }
  const [overview, payroll, declarations, banks] = await Promise.all([
    caller.overview(),
    caller.payroll.sheet({ month: '2026-M07' }),
    caller.declarations.list(),
    caller.banks.list(),
  ]);

  const stats: ReadonlyArray<{ label: string; value: string; accent?: 'risk' | 'ok' }> = [
    { label: 'Автопроводок', value: String(overview.автопроводок), accent: 'ok' },
    { label: 'На подтверждении', value: String(overview.наПодтверждении) },
    { label: 'Под риском', value: `${Number(overview.подРискомТенге).toLocaleString('ru-RU')} ₸`, accent: 'risk' },
    {
      label: 'Ближайший срок',
      value: overview.ближайшийСрок === null ? '—' : `${overview.ближайшийСрок.дата}`,
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Sana — обзор</h1>
        <p className="text-sm text-stone-500">
          Все цифры ниже прочитаны из реестра, очереди подтверждения, находок Sana Guard и календаря —
          ничего не захардкожено. <Link className="underline" href="/">Лента рисков →</Link>
        </p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-stone-500">{s.label}</div>
            <div
              className={`mt-1 text-lg font-semibold tabular-nums ${
                s.accent === 'risk' ? 'text-red-700' : s.accent === 'ok' ? 'text-emerald-700' : ''
              }`}
            >
              {s.value}
            </div>
          </div>
        ))}
      </section>

      {overview.ближайшийСрок !== null && (
        <p className="mb-8 text-sm text-stone-600">
          Ближайший срок: <b>{overview.ближайшийСрок.название}</b> — {overview.ближайшийСрок.дата}{' '}
          (осталось {overview.ближайшийСрок.осталосьДней} дн.)
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Зарплата · {payroll.месяц}
        </h2>
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-sm">
          Сотрудников: <b>{payroll.сводка.сотрудников}</b> · Начислено:{' '}
          <b className="tabular-nums">{payroll.сводка.начислено.tenge} ₸</b> · Удержано (ИПН+ОПВ+ВОСМС):{' '}
          <b className="tabular-nums">{payroll.сводка.удержано.tenge} ₸</b> · Проверено:{' '}
          <b>
            {payroll.сводка.проверено} / {payroll.сводка.сотрудников}
          </b>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Декларации</h2>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white shadow-sm">
          {declarations.map((d) => (
            <li key={d.форма} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <div className="font-medium">Форма {d.форма}</div>
                <div className="text-xs text-stone-500">{d.описание}</div>
              </div>
              <div className="text-right text-xs">
                <div>{d.статус}</div>
                {d.срок !== null && <div className="text-stone-500">срок {d.срок}</div>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Банки</h2>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white shadow-sm">
          {banks.map((b) => (
            <li key={b.id} className="flex items-center justify-between p-4 text-sm">
              <span>{b.банк}</span>
              <span className={b.статус === 'Подключено' ? 'text-emerald-700' : 'text-stone-400'}>
                {b.статус}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
