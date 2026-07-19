import { getCaller } from '../../lib/server';

export const dynamic = 'force-dynamic';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Календарь сроков (§9): дедлайны из legal-params, обязательств кабинета
 * НП и уведомлений КГД — всё, что система уже знает.
 */
export default async function CalendarPage() {
  const caller = await getCaller();
  const calendar = await caller.calendar.deadlines();

  return (
    <section>
      <p className="page-sub">
        Все сроки ФНО и платежей — в одном месте. Сегодня в системе: {calendar.сегодня}.
      </p>

      <div className="listcard">
        {calendar.сроки.map((d, i) => {
          const [_, month, day] = d.дата.split('-');
          const overdue = d.осталосьДней < 0;
          return (
            <div key={i} className="row">
              <div className="w-[52px] flex-shrink-0 text-center">
                <div className="text-[19px] font-semibold leading-none">{Number(day)}</div>
                <div className="text-[10.5px] uppercase tracking-wide text-slate-light">
                  {MONTHS[Number(month) - 1]}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{d.название}</div>
                <div className="text-[11.5px] text-slate-light">
                  {d.подпись} · источник: {d.источник}
                </div>
              </div>
              {overdue ? (
                <span className="badge-warn">просрочено {-d.осталосьДней} дн.</span>
              ) : d.скоро ? (
                <span className="badge-warn">через {d.осталосьДней} дн.</span>
              ) : (
                <span className="badge-teal">В графике · {d.осталосьДней} дн.</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
