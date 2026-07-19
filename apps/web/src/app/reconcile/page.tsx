import { lastRecon } from '../../lib/server';
import { reconcileAction } from '../actions';

export const dynamic = 'force-dynamic';

const DEMO_SUMMARY = [
  'Дата;Сумма;Контрагент',
  '2026-07-01;100000;Аренда офиса',
  '2026-07-03;84500;ТОО «Каспий Строй»',
  '2026-07-07;250000;Оплата Каспий Строй',
  '2026-07-07;250000;Оплата Каспий Строй',
  '2026-07-12;65000;ИП Абенов',
].join('\n');

const DEMO_JOURNAL = [
  'Дата;Сумма;Контрагент',
  '2026-07-01;100000;Аренда офиса',
  '2026-07-03;84000;ТОО «Каспий Строй»',
  '2026-07-07;250000;Оплата Каспий Строй',
  ';65000;ИП Абенов',
].join('\n');

/**
 * Сверка данных (§12): построчное сопоставление двух файлов — список
 * несовпадений человеческим языком, не технический дифф.
 */
export default async function ReconcilePage() {
  const report = lastRecon();

  return (
    <section>
      <p className="page-sub">
        Загрузите два файла или сводную таблицу — Sana найдёт несовпадения от ручного ввода. Понятным
        языком, без терминов.
      </p>

      <form action={reconcileAction} className="card">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-slate-mock">
              Файл А — сводная таблица (CSV)
            </label>
            <textarea name="csvA" rows={7} defaultValue={DEMO_SUMMARY} className="input-mock font-mono text-[11.5px]" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-slate-mock">
              Файл Б — журнал проводок (CSV, можно пусто)
            </label>
            <textarea name="csvB" rows={7} defaultValue={DEMO_JOURNAL} className="input-mock font-mono text-[11.5px]" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" className="btn-primary">
            Сверить строка за строкой
          </button>
          <span className="text-[11.5px] text-slate-light">
            Демо-файлы уже содержат 3 специально внесённых несовпадения.
          </span>
        </div>
      </form>

      {report !== null && (
        <div className="mt-5">
          {report.ok ? (
            <>
              <div className="section-h">
                {report.несовпадения.length === 0
                  ? 'Всё совпало'
                  : `Найдено ${report.несовпадения.length} несовпадения`}
                <span className="tag-sm">из {report.строкПроверено} строк проверено</span>
              </div>
              <div className="listcard">
                {report.несовпадения.map((m, i) => (
                  <div key={i} className="row items-start">
                    <div
                      className={`mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-sm ${
                        m.действие === 'Проверить'
                          ? 'bg-coral-050 text-red-600'
                          : 'bg-amber-050 text-amber-700'
                      }`}
                    >
                      ⚠
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold">{m.заголовок}</div>
                      <div className="mt-0.5 text-[12px] leading-relaxed text-slate-mock">{m.объяснение}</div>
                    </div>
                    <span className={m.действие === 'Проверить' ? 'badge-warn' : 'badge-amber'}>
                      {m.действие}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[11.5px] text-slate-light">
                {report.строкСовпало} из {report.строкПроверено} строк совпали без замечаний — остальные
                Sana выделила специально, чтобы вы проверили вручную.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-coral-050 bg-coral-050 px-4 py-3 text-sm text-red-700">
              <div className="font-semibold">{report.сообщение}</div>
              <ul className="mt-1.5 space-y-1 text-[12.5px]">
                {report.ошибки.map((e, i) => (
                  <li key={i}>
                    {e.строка !== null && <b>Строка {e.строка}: </b>}
                    {e.сообщение}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
