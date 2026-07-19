import { getCaller, lastImport } from '../../lib/server';
import { importJournalAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Отчётность (§4): Баланс / ОПиУ / Кэш-флоу — из проводок реестра,
 * с проверкой сходимости. Импорт CSV — построчная диагностика,
 * несбалансированный файл отклоняется, а не проглатывается.
 */
export default async function ReportsPage() {
  const caller = await getCaller();
  const [bs, pl, cf] = await Promise.all([
    caller.accounting.balanceSheet({ asOf: '2026-05-10' }),
    caller.accounting.profitLoss({ period: '2026-H1' }),
    caller.accounting.cashFlow({ period: '2026-H1' }),
  ]);
  const imported = lastImport();

  const assets = bs.активы.total.tenge;
  const liabilities = bs.обязательства.total.tenge;
  const equity = bs.капитал.total.tenge;

  return (
    <section>
      <p className="page-sub">
        Три отчёта построены из проводок реестра с проверкой сходимости. Загрузите CSV с проводками —
        они встанут в тот же реестр.
      </p>

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="card">
          <h5 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold">
            <i className="h-1.5 w-1.5 rounded-full bg-teal" /> Баланс
            <span className="tag-sm ml-auto">на 2026-05-10</span>
          </h5>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Активы <b className="tabular-nums text-indigo-deep">{assets} ₸</b>
          </div>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Обязательства <b className="tabular-nums text-indigo-deep">{liabilities} ₸</b>
          </div>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Капитал <b className="tabular-nums text-indigo-deep">{equity} ₸</b>
          </div>
          <div className="mt-2 flex justify-between border-t border-border-soft pt-2 text-[12.5px] font-semibold">
            {bs.балансСходится ? (
              <>
                <span className="text-green-700">Актив = Пассив</span>
                <span className="text-green-700">✓</span>
              </>
            ) : (
              <span className="text-red-600">Баланс не сходится!</span>
            )}
          </div>
        </div>

        <div className="card">
          <h5 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold">
            <i className="h-1.5 w-1.5 rounded-full bg-teal" /> ОПиУ (PnL)
            <span className="tag-sm ml-auto">{pl.период}</span>
          </h5>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Выручка <b className="tabular-nums text-indigo-deep">{pl.доходы.total.tenge} ₸</b>
          </div>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Расходы <b className="tabular-nums text-indigo-deep">{pl.расходы.total.tenge} ₸</b>
          </div>
          <div className="mt-2 flex justify-between border-t border-border-soft pt-2 text-[12.5px] font-semibold">
            <span>Прибыль</span>
            <span className="tabular-nums text-green-700">{pl.прибыль.tenge} ₸</span>
          </div>
        </div>

        <div className="card">
          <h5 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold">
            <i className="h-1.5 w-1.5 rounded-full bg-teal" /> Кэш-флоу
            <span className="tag-sm ml-auto">{cf.период}</span>
          </h5>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Операционный{' '}
            <b className="tabular-nums text-green-700">{cf.операционная.итого.tenge} ₸</b>
          </div>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Инвестиционный <b className="tabular-nums text-indigo-deep">{cf.инвестиционная.итого.tenge} ₸</b>
          </div>
          <div className="flex justify-between py-1 text-[12.5px] text-slate-mock">
            Финансовый <b className="tabular-nums text-indigo-deep">{cf.финансовая.итого.tenge} ₸</b>
          </div>
          <div className="mt-2 flex justify-between border-t border-border-soft pt-2 text-[12.5px] font-semibold">
            <span>Остаток на конец</span>
            <span className="tabular-nums">{cf.денежныеСредстваНаКонец.tenge} ₸</span>
          </div>
        </div>
      </div>

      <div className="section-h">
        Импорт проводок из Excel (CSV) <span className="tag-sm">Дт · Кт · сумма · дата · описание</span>
      </div>
      <form action={importJournalAction} className="card">
        <textarea
          name="csv"
          rows={5}
          placeholder={
            'Вставьте CSV или оставьте пустым — загрузится демо-файл.\nДата;Счёт Дт;Счёт Кт;Сумма;Описание;Операция'
          }
          className="input-mock mb-3 font-mono text-[12px]"
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            Загрузить и провести
          </button>
          <span className="text-[11.5px] text-slate-light">
            Несбалансированный файл будет отклонён с диагностикой по строкам.
          </span>
        </div>
      </form>

      {imported !== null && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            imported.ok ? 'border-green-050 bg-green-050 text-green-800' : 'border-coral-050 bg-coral-050 text-red-700'
          }`}
        >
          <div className="font-semibold">{imported.сообщение}</div>
          {!imported.ok && (
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {imported.ошибки.map((e, i) => (
                <li key={i}>
                  {e.строка !== null && <b>Строка {e.строка}: </b>}
                  {e.сообщение}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
