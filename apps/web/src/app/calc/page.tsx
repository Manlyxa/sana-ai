import Link from 'next/link';
import { getCaller } from '../../lib/server';

export const dynamic = 'force-dynamic';

type Params = {
  tool?: string;
  prev?: string;
  cur?: string;
  turnover?: string;
  amount?: string;
  days?: string;
};

function num(v: string | undefined, fallback: number): number {
  const parsed = Number(v);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/**
 * Калькуляторы (§11): считают ТЕМИ ЖЕ функциями, что и движок —
 * ИПН через cumulativeIpn зарплаты, порог НДС той же функцией, что
 * Sana Guard, пеня по ставке НБ из legal-params.
 */
export default async function CalcPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const tool = p.tool ?? 'ipn';
  const caller = await getCaller();

  const tabs = [
    { id: 'ipn', title: 'ИПН сотрудника', sub: 'нарастающим итогом' },
    { id: 'vat', title: 'Порог по НДС', sub: 'сколько осталось до регистрации' },
    { id: 'penalty', title: 'Пеня за просрочку', sub: 'штраф за поздний платёж' },
  ];

  // Расчёты — только при наличии параметров инструмента.
  const ipn =
    tool === 'ipn'
      ? await caller.calculators.ipn({
          доходСНачалаГодаТенге: num(p.prev, 1_500_000),
          начислениеМесяцаТенге: num(p.cur, 250_000),
        })
      : null;
  const vat =
    tool === 'vat'
      ? await caller.calculators.vatThreshold({ оборотСНачалаГодаТенге: num(p.turnover, 34_800_000) })
      : null;
  const pen =
    tool === 'penalty'
      ? await caller.calculators.penalty({
          суммаНалогаТенге: num(p.amount, 1_044_000),
          днейПросрочки: num(p.days, 12),
        })
      : null;

  return (
    <section>
      <p className="page-sub">
        Хотите перепроверить цифру сами? Эти калькуляторы считают той же логикой, что и Sana внутри.
      </p>

      <div className="grid grid-cols-3 gap-3">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/calc?tool=${t.id}`}
            className={`card text-left transition hover:-translate-y-0.5 ${
              tool === t.id ? '!border-teal bg-teal-050' : 'hover:border-teal'
            }`}
          >
            <div className="text-[13px] font-semibold">{t.title}</div>
            <div className="text-[11.5px] text-slate-light">{t.sub}</div>
          </Link>
        ))}
      </div>

      <div className="card mt-4">
        {tool === 'ipn' && ipn !== null && (
          <>
            <div className="mb-3 text-[14.5px] font-semibold">ИПН сотрудника нарастающим итогом</div>
            <form method="get" className="grid gap-3 lg:grid-cols-2">
              <input type="hidden" name="tool" value="ipn" />
              <label className="text-[11.5px] text-slate-mock">
                Облагаемая база с начала года до этого месяца, ₸
                <input name="prev" defaultValue={num(p.prev, 1_500_000)} className="input-mock mt-1" />
              </label>
              <label className="text-[11.5px] text-slate-mock">
                Облагаемая база этого месяца, ₸
                <input name="cur" defaultValue={num(p.cur, 250_000)} className="input-mock mt-1" />
              </label>
              <div>
                <button type="submit" className="btn-primary">
                  Рассчитать
                </button>
              </div>
            </form>
            <div className="mt-3.5 rounded-xl border border-teal-100 bg-teal-050 px-4 py-3.5 text-sm">
              ИПН к удержанию за этот месяц:{' '}
              <b className="tabular-nums">{ipn.ипнМесяца.tenge} ₸</b>
              {ipn.пересеченПотолок && (
                <span className="badge-amber ml-2">пересечён потолок 8500 МРП → часть по 15%</span>
              )}
              <div className="mt-1.5 text-[11.5px] text-slate-mock">
                Налог со всей базы с начала года ({ipn.накопленоБазыПосле.tenge} ₸) минус уже удержанное.
                Потолок 1-й ступени: {ipn.потолок1йСтупени.tenge} ₸ · {ipn.норма} · {ipn.версияПараметров}
              </div>
            </div>
          </>
        )}

        {tool === 'vat' && vat !== null && (
          <>
            <div className="mb-3 text-[14.5px] font-semibold">Порог по НДС</div>
            <form method="get" className="grid gap-3 lg:grid-cols-2">
              <input type="hidden" name="tool" value="vat" />
              <label className="text-[11.5px] text-slate-mock">
                Оборот с начала года, ₸
                <input name="turnover" defaultValue={num(p.turnover, 34_800_000)} className="input-mock mt-1" />
              </label>
              <label className="text-[11.5px] text-slate-mock">
                Порог регистрации (из legal-params, не редактируется)
                <input value={`${vat.порог.tenge} ₸ = 10 000 МРП`} disabled className="input-mock mt-1 bg-paper" />
              </label>
              <div>
                <button type="submit" className="btn-primary">
                  Рассчитать
                </button>
              </div>
            </form>
            <div className="mt-3.5 rounded-xl border border-teal-100 bg-teal-050 px-4 py-3.5 text-sm">
              {vat.порогПревышен ? (
                <>
                  Порог уже превышен на <b className="tabular-nums">{vat.превышение.tenge} ₸</b>. Нужно
                  подать заявление на регистрацию по НДС ({vat.днейНаЗаявление} рабочих дней).
                </>
              ) : (
                <>
                  До порога регистрации осталось: <b className="tabular-nums">{vat.осталосьДоПорога.tenge} ₸</b>{' '}
                  ({vat.занятоПроцентов}% порога уже набрано)
                </>
              )}
              <div className="mt-1.5 text-[11.5px] text-slate-mock">
                Та же функция, что в Sana Guard · {vat.норма} · {vat.версияПараметров}
              </div>
            </div>
          </>
        )}

        {tool === 'penalty' && pen !== null && (
          <>
            <div className="mb-3 text-[14.5px] font-semibold">Пеня за просрочку платежа</div>
            <form method="get" className="grid gap-3 lg:grid-cols-2">
              <input type="hidden" name="tool" value="penalty" />
              <label className="text-[11.5px] text-slate-mock">
                Сумма налога, ₸
                <input name="amount" defaultValue={num(p.amount, 1_044_000)} className="input-mock mt-1" />
              </label>
              <label className="text-[11.5px] text-slate-mock">
                Дней просрочки
                <input name="days" defaultValue={num(p.days, 12)} className="input-mock mt-1" />
              </label>
              <div>
                <button type="submit" className="btn-primary">
                  Рассчитать
                </button>
              </div>
            </form>
            <div className="mt-3.5 rounded-xl border border-teal-100 bg-teal-050 px-4 py-3.5 text-sm">
              Пеня за {num(p.days, 12)} дней просрочки: <b className="tabular-nums">{pen.пеня.tenge} ₸</b>
              <div className="mt-1.5 text-[11.5px] text-slate-mock">
                Эффективная годовая ставка {pen.эффективнаяГодоваяСтавка} (базовая НБ × 1,25) · {pen.норма} ·{' '}
                {pen.версияПараметров}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
