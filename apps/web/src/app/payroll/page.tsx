import { getCaller } from '../../lib/server';
import { payrollAccrueAllAction, payrollConfirmAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Зарплата и кадры (§6): ИПН нарастающим итогом из доменного движка,
 * каждый расчёт раскрывается и подтверждается отдельно.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const caller = await getCaller();
  const sheet = await caller.payroll.sheet({ month: '2026-M07' });
  const { notice } = await searchParams;
  const allConfirmed = sheet.сводка.проверено === sheet.сводка.сотрудников;

  return (
    <section>
      <p className="page-sub">
        ИПН считается нарастающим итогом с начала года. Каждый расчёт — со ссылкой на ставку и открыт
        для проверки.
      </p>

      {notice !== undefined && (
        <div className="mb-4 rounded-xl border border-teal-100 bg-teal-050 px-4 py-3 text-sm">{notice}</div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card !p-3.5">
          <div className="text-[11px] text-slate-light">Сотрудников</div>
          <div className="text-[17px] font-semibold tabular-nums">{sheet.сводка.сотрудников}</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] text-slate-light">Начислено</div>
          <div className="text-[17px] font-semibold tabular-nums">{sheet.сводка.начислено.tenge} ₸</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] text-slate-light">Удержано (ИПН+ОПВ+ВОСМС)</div>
          <div className="text-[17px] font-semibold tabular-nums">{sheet.сводка.удержано.tenge} ₸</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-[11px] text-slate-light">Проверено</div>
          <div
            className={`text-[17px] font-semibold tabular-nums ${allConfirmed ? 'text-green-700' : 'text-amber-600'}`}
          >
            {sheet.сводка.проверено} / {sheet.сводка.сотрудников}
          </div>
        </div>
      </div>

      <div className="listcard">
        {sheet.строки.map((emp) => {
          const verified = emp.статус === 'Проверено';
          const initials = emp.фио
            .split(' ')
            .slice(0, 2)
            .map((w) => w[0])
            .join('');
          return (
            <details key={emp.иин} className={`group border-b border-border-soft last:border-b-0 ${verified ? 'bg-green-050/40' : ''}`}>
              <summary className="grid cursor-pointer list-none grid-cols-[36px_1fr_auto_auto] items-center gap-3 px-4 py-3 hover:bg-paper">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal-050 text-xs font-semibold text-teal-700">
                  {initials}
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold">{emp.фио}</div>
                  <div className="text-[11.5px] text-slate-light">{emp.должность}</div>
                </div>
                <span className={verified ? 'badge-ok' : 'badge-amber'}>
                  {verified ? 'Проверено' : 'Ждёт проверки'}
                </span>
                <div className="text-right text-[13.5px] font-semibold tabular-nums">
                  {emp.кВыплате.tenge} ₸
                </div>
              </summary>
              <div className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-border-soft bg-paper p-3 lg:grid-cols-5">
                  <div>
                    <div className="text-[10.5px] text-slate-light">Начислено</div>
                    <div className="text-[13.5px] font-semibold tabular-nums">{emp.начислено.tenge}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-slate-light">ОПВ 10%</div>
                    <div className="text-[13.5px] font-semibold tabular-nums text-red-600">
                      −{emp.опв.tenge}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-slate-light">ВОСМС 2%</div>
                    <div className="text-[13.5px] font-semibold tabular-nums text-red-600">
                      −{emp.восмс.tenge}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-slate-light">ИПН (нараст. итог)</div>
                    <div className="text-[13.5px] font-semibold tabular-nums text-red-600">
                      −{emp.ипн.tenge}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-slate-light">К выплате</div>
                    <div className="text-[13.5px] font-semibold tabular-nums text-green-700">
                      {emp.кВыплате.tenge}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-slate-light">
                  СО (за счёт компании, не удерживается): {emp.соЗаСчётКомпании.tenge} ₸ · облагаемая база
                  с начала года до этого месяца: {emp.доходСНачалаГодаДоМесяца.tenge} ₸ · ИПН считается от
                  совокупного дохода с начала года, а не от месяца в изоляции. Норма: {emp.норма} ·{' '}
                  {emp.версияПараметров}
                </div>
                {!verified && (
                  <form action={payrollConfirmAction} className="mt-3">
                    <input type="hidden" name="iin" value={emp.иин} />
                    <button type="submit" className="btn-green !px-3.5 !py-1.5 text-[12.5px]">
                      ✓ Подтвердить расчёт
                    </button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <div className="mt-4 flex gap-2.5">
        <form action={payrollAccrueAllAction}>
          <button type="submit" className="btn-primary">
            ✓ Подтвердить все и начислить за июль
          </button>
        </form>
        <a href="/calc?tool=ipn" className="btn-ghost">
          Перепроверить в калькуляторе
        </a>
      </div>
    </section>
  );
}
