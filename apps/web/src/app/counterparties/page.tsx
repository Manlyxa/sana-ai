import Link from 'next/link';
import { getCaller } from '../../lib/server';

export const dynamic = 'force-dynamic';

/**
 * Контрагенты (§7а): список из проводок реестра со статусом риска из
 * реестра КГД. Рисковые — первыми.
 */
export default async function CounterpartiesPage() {
  const caller = await getCaller();
  const list = await caller.counterparties.list();

  return (
    <section>
      <p className="page-sub">
        Контрагенты собраны из проводок реестра и сверяются с реестром КГД на признаки риска.{' '}
        <Link href="/cpcheck" className="text-teal-700 underline">
          Точечная проверка по БИН →
        </Link>
      </p>

      <div className="listcard">
        {list.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-mock">
            В реестре пока нет проводок с контрагентами.
          </div>
        ) : (
          list.map((cp) => {
            const risky = cp.статус === 'В перечне риска КГД';
            const unknown = cp.статус === 'Нет в реестре проверки';
            return (
              <div key={cp.бин} className="row">
                <div
                  className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-sm ${
                    risky ? 'bg-coral-050 text-red-600' : 'bg-teal-050 text-teal-700'
                  }`}
                >
                  {risky ? '!' : '✓'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{cp.наименование}</div>
                  <div className="text-[11.5px] text-slate-light">
                    БИН {cp.бин} · {cp.сделок}{' '}
                    {cp.сделок === 1 ? 'сделка' : cp.сделок < 5 ? 'сделки' : 'сделок'} ·{' '}
                    {cp.оборот.tenge} ₸
                  </div>
                  {cp.вердикт !== null && cp.вердикт.причины.length > 0 && (
                    <div className="mt-1 text-[11.5px] text-red-600">
                      {cp.вердикт.причины.join('; ')}
                      {cp.вердикт.норма !== null && (
                        <span className="text-slate-light"> · {cp.вердикт.норма}</span>
                      )}
                    </div>
                  )}
                </div>
                <span className={risky ? 'badge-warn' : unknown ? 'badge-muted' : 'badge-ok'}>
                  {cp.статус}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
