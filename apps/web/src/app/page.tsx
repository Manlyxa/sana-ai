import Link from 'next/link';
import { getCaller } from '../lib/server';
import { tiynToTenge } from '../lib/format';

export const dynamic = 'force-dynamic';

/**
 * Обзор (§1) — витрина состояния компании. Каждая цифра прочитана из
 * своего модуля (реестр, очередь, находки, календарь) — ничего не
 * захардкожено.
 */
export default async function OverviewPage() {
  const caller = await getCaller();
  const [overview, payroll, declarations] = await Promise.all([
    caller.overview(),
    caller.payroll.sheet({ month: '2026-M07' }),
    caller.declarations.list(),
  ]);

  const quick = [
    { href: '/autopost', title: 'Автопроводки', sub: `${overview.наПодтверждении} ждут решения` },
    { href: '/guard', title: 'Sana Guard', sub: `${overview.открытыхРисков} открытых риска` },
    { href: '/reports', title: 'Отчётность', sub: 'Баланс · ОПиУ · Кэш-флоу' },
    { href: '/ask', title: 'Спроси Sana', sub: 'Вопрос со ссылкой на НК' },
  ];

  return (
    <section>
      <p className="page-sub">Sana ведёт учёт и следит за рисками. Вам остаётся подтверждать — не считать.</p>

      <div className="rounded-2xl bg-gradient-to-br from-indigo-deep via-indigo-700d to-teal-700 p-6 text-white">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] text-[#9FB3D6]">Состояние компании · данные реестра</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#9FF0EA]">
            <i className="h-1.5 w-1.5 rounded-full bg-teal" /> Sana на связи
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-[11.5px] text-[#9FB3D6]">Автопроводок</div>
            <div className="text-2xl font-semibold tabular-nums text-[#7BE7B0]">{overview.автопроводок}</div>
          </div>
          <div>
            <div className="text-[11.5px] text-[#9FB3D6]">На подтверждении</div>
            <div className="text-2xl font-semibold tabular-nums">{overview.наПодтверждении}</div>
          </div>
          <div>
            <div className="text-[11.5px] text-[#9FB3D6]">Под риском</div>
            <div className="text-2xl font-semibold tabular-nums text-[#FF9B9B]">
              {tiynToTenge(overview.подРискомТиын)}
            </div>
          </div>
          <div>
            <div className="text-[11.5px] text-[#9FB3D6]">Ближайший срок</div>
            <div className="text-[17px] font-semibold tabular-nums">
              {overview.ближайшийСрок === null ? '—' : overview.ближайшийСрок.дата}
            </div>
            {overview.ближайшийСрок !== null && (
              <div className="mt-0.5 truncate text-[11px] text-[#9FB3D6]">
                {overview.ближайшийСрок.название}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section-h">
        Быстрый переход <span className="tag-sm">кликните, чтобы открыть модуль</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {quick.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="card transition hover:-translate-y-0.5 hover:border-teal"
          >
            <div className="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-teal-050 text-sm font-bold text-teal-700">
              →
            </div>
            <div className="text-sm font-semibold">{q.title}</div>
            <div className="text-[11.5px] text-slate-light">{q.sub}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="listcard">
          <div className="row bg-paper text-xs font-semibold text-slate-mock">
            Зарплата · {payroll.месяц}
            <Link href="/payroll" className="ml-auto text-teal-700 hover:underline">
              открыть →
            </Link>
          </div>
          <div className="row text-sm">
            <span>Сотрудников</span>
            <b className="ml-auto tabular-nums">{payroll.сводка.сотрудников}</b>
          </div>
          <div className="row text-sm">
            <span>Начислено</span>
            <b className="ml-auto tabular-nums">{payroll.сводка.начислено.tenge} ₸</b>
          </div>
          <div className="row text-sm">
            <span>Проверено</span>
            <b
              className={`ml-auto tabular-nums ${
                payroll.сводка.проверено === payroll.сводка.сотрудников
                  ? 'text-green-700'
                  : 'text-amber-600'
              }`}
            >
              {payroll.сводка.проверено} / {payroll.сводка.сотрудников}
            </b>
          </div>
        </div>

        <div className="listcard">
          <div className="row bg-paper text-xs font-semibold text-slate-mock">
            Декларации
            <Link href="/declarations" className="ml-auto text-teal-700 hover:underline">
              открыть →
            </Link>
          </div>
          {declarations.map((d) => (
            <div key={d.форма} className="row text-sm">
              <span>Форма {d.форма}</span>
              <span className="ml-auto flex items-center gap-2">
                {d.срок !== null && <span className="text-[11px] text-slate-light">срок {d.срок}</span>}
                <span
                  className={
                    d.статус === 'Готово к сдаче'
                      ? 'badge-ok'
                      : d.статус === 'В процессе'
                        ? 'badge-amber'
                        : 'badge-muted'
                  }
                >
                  {d.статус}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
