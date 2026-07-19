import Link from 'next/link';
import { getCaller } from '../../lib/server';

export const dynamic = 'force-dynamic';

/**
 * Декларации ФНО (§5): 910.00 заполнена расчётом из реестра, 200.00 —
 * свод из зарплатных ведомостей, 300.00 — мониторинг порога НДС.
 */
export default async function DeclarationsPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string }>;
}) {
  const caller = await getCaller();
  const list = await caller.declarations.list();
  const { form } = await searchParams;
  const detail910 = form === '910' ? await caller.declarations.form910({ period: '2026-H1' }) : null;

  return (
    <section>
      <p className="page-sub">Формы заполняются из ваших данных. Проверьте перед сдачей.</p>

      <div className="listcard">
        {list.map((d) => (
          <div key={d.форма} className="row">
            <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-teal-050 text-[13px] font-bold text-teal-700">
              §
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">Форма {d.форма}</div>
              <div className="text-[11.5px] text-slate-light">{d.описание}</div>
            </div>
            {d.срок !== null && (
              <div className="text-right text-[11.5px] text-slate-light">срок {d.срок}</div>
            )}
            <span
              className={
                d.статус === 'Готово к сдаче'
                  ? 'badge-ok'
                  : d.статус === 'В процессе'
                    ? 'badge-amber'
                    : d.статус === 'Требуется регистрация'
                      ? 'badge-warn'
                      : 'badge-muted'
              }
            >
              {d.статус}
            </span>
            {d.форма === '910.00' && (
              <Link href="/declarations?form=910" className="btn-ghost !px-3 !py-1.5 text-[12px]">
                Открыть
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {list.map((d) => (
          <div key={d.форма} className="card">
            <div className="mb-2 text-[13px] font-semibold">Форма {d.форма}</div>
            <div className="grid gap-2">
              {Object.entries(d.поля).map(([k, v]) => (
                <div key={k} className="field-box">
                  <div className="text-[11px] text-slate-light">{k}</div>
                  <div className="text-[14px] font-semibold tabular-nums">
                    {typeof v === 'object' && v !== null && 'tenge' in v
                      ? `${(v as { tenge: string }).tenge} ₸`
                      : String(v)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-light">
              Норма: {d.норма} · {d.версияПараметров}
            </div>
          </div>
        ))}
      </div>

      {detail910 !== null && (
        <div className="card mt-5 border-teal">
          <div className="text-[15px] font-semibold">Форма 910.00 — полный расчёт</div>
          <div className="mt-0.5 text-[12.5px] text-slate-mock">
            Упрощённая декларация · {detail910.период} · срок сдачи {detail910.срокСдачи}
          </div>
          <div className="my-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <div className="field-box">
              <div className="text-[11px] text-slate-light">Доход (910.00.001)</div>
              <div className="text-[14px] font-semibold tabular-nums">{detail910.доход.tenge} ₸</div>
            </div>
            <div className="field-box">
              <div className="text-[11px] text-slate-light">Ставка СНР</div>
              <div className="text-[14px] font-semibold tabular-nums">{detail910.ставка}</div>
            </div>
            <div className="field-box">
              <div className="text-[11px] text-slate-light">Налог к уплате</div>
              <div className="text-[14px] font-semibold tabular-nums">{detail910.налогКУплате.tenge} ₸</div>
            </div>
            <div className="field-box">
              <div className="text-[11px] text-slate-light">Предел дохода СНР</div>
              <div className="text-[14px] font-semibold tabular-nums">
                {detail910.пределПревышен ? 'ПРЕВЫШЕН' : 'в норме'}
              </div>
            </div>
          </div>
          <div className="text-[11.5px] text-slate-light">
            Каждая цифра объяснима: {detail910.проводкиОснования.length} проводок-оснований ·{' '}
            {detail910.норма} · {detail910.версияПараметров}
          </div>
        </div>
      )}
    </section>
  );
}
