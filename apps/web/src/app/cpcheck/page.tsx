import { getCaller, lastCpCheck } from '../../lib/server';
import { cpCheckAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Проверка контрагента (§7б): БИН → явный вердикт «есть риск / нет риска»
 * с причиной и нормой. Чтение реестра КГД, история проверок сеанса.
 */
export default async function CpCheckPage() {
  const caller = await getCaller();
  const history = await caller.counterparties.checkHistory();
  const result = lastCpCheck();

  return (
    <section>
      <p className="page-sub">
        Введите БИН или название — Sana сверит контрагента с реестром рисков КГД за секунду.
      </p>

      <div className="card">
        <form action={cpCheckAction} className="flex gap-2.5">
          <input
            type="text"
            name="bin"
            placeholder="БИН контрагента, например 180240000001"
            className="input-mock flex-1"
          />
          <button type="submit" className="btn-primary">
            Проверить
          </button>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <form action={cpCheckAction}>
            <input type="hidden" name="bin" value="180240000001" />
            <button type="submit" className="badge-teal hover:bg-teal-100">
              Пример: рисковый контрагент
            </button>
          </form>
          <form action={cpCheckAction}>
            <input type="hidden" name="bin" value="201140000007" />
            <button type="submit" className="badge-teal hover:bg-teal-100">
              Пример: надёжный контрагент
            </button>
          </form>
        </div>
      </div>

      {result !== null && (
        <div className="mt-4">
          {result.kind === 'FOUND' ? (
            <div
              className={`rounded-2xl border p-4 ${
                result.вердикт === 'Есть риск'
                  ? 'border-coral bg-coral-050'
                  : 'border-teal bg-teal-050'
              }`}
            >
              <div className="mb-2 flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-white text-base">
                  {result.вердикт === 'Есть риск' ? '⚠' : '✓'}
                </div>
                <div>
                  <div className="text-[15px] font-semibold">{result.наименование}</div>
                  <div className="text-[11.5px] text-slate-light">БИН {result.бин} · проверено только что</div>
                </div>
                <span className={`ml-auto ${result.вердикт === 'Есть риск' ? 'badge-warn' : 'badge-ok'}`}>
                  {result.вердикт}
                </span>
              </div>
              {result.причины.length > 0 ? (
                <div className="text-[13px] leading-relaxed text-indigo-700d">
                  {result.причины.join('; ')}.
                </div>
              ) : (
                <div className="text-[13px] leading-relaxed text-indigo-700d">
                  Признаков риска не найдено. Контрагент зарегистрирован, в перечнях риска не значится.
                </div>
              )}
              {result.норма !== null && (
                <div className="mt-2 text-[11.5px] text-slate-light">Норма: {result.норма}</div>
              )}
            </div>
          ) : (
            <div className="card text-sm text-slate-mock">{result.сообщение}</div>
          )}
        </div>
      )}

      <div className="section-h">
        История проверок <span className="tag-sm">за этот сеанс</span>
      </div>
      <div className="listcard">
        {history.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-mock">Проверок ещё не было.</div>
        ) : (
          history.map((h, i) => (
            <div key={i} className="row">
              <div
                className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-sm ${
                  h.вердикт === 'Есть риск' ? 'bg-coral-050 text-red-600' : 'bg-teal-050 text-teal-700'
                }`}
              >
                {h.вердикт === 'Есть риск' ? '!' : '✓'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{h.наименование}</div>
                <div className="text-[11.5px] text-slate-light">
                  БИН {h.бин} · проверено {h.проверено}
                </div>
              </div>
              <span className={h.вердикт === 'Есть риск' ? 'badge-warn' : 'badge-ok'}>{h.вердикт}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
