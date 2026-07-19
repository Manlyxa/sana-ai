import { getCaller } from '../../lib/server';
import { connectBankAction } from '../actions';

export const dynamic = 'force-dynamic';

const BANK_COLORS: Record<string, string> = {
  kaspi: '#E4272B',
  halyk: '#00A651',
  bcc: '#F5A623',
  freedom: '#0057B8',
  forte: '#7B2D8E',
  jusan: '#1B1F3B',
};

/**
 * Банковские счета (§13): подключённые источники питают автопроводки.
 * «Подключить» создаёт запись источника (фикстура; реальные API банков —
 * следующая волна, заменит порт, не экран).
 */
export default async function BanksPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const caller = await getCaller();
  const banks = await caller.banks.list();
  const { notice } = await searchParams;
  const connected = banks.filter((b) => b.статус === 'Подключено');
  const available = banks.filter((b) => b.статус !== 'Подключено');

  return (
    <section>
      <p className="page-sub">
        Подключите счета в разных банках — Sana сама подтянет движения и объединит их в один учёт.
      </p>

      {notice !== undefined && (
        <div className="mb-4 rounded-xl border border-coral-050 bg-coral-050 px-4 py-3 text-sm text-red-700">
          {notice}
        </div>
      )}

      <div className="listcard">
        {connected.map((b) => (
          <div key={b.id} className="row !py-3.5">
            <div
              className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-[13px] font-bold text-white"
              style={{ backgroundColor: BANK_COLORS[b.id] ?? '#1B1F3B' }}
            >
              {b.код}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{b.банк}</div>
              <div className="text-[11.5px] text-slate-light">
                {b.iban} · подключён {b.подключён}
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-light">
              <i className="h-1.5 w-1.5 rounded-full bg-green-mock" /> выписки в автопроводках
            </span>
            <span className="badge-ok">Подключено</span>
          </div>
        ))}
      </div>

      <div className="section-h">
        Добавить банк <span className="tag-sm">выберите из списка</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {available.map((b) => (
          <form key={b.id} action={connectBankAction} className="card text-center transition hover:-translate-y-0.5 hover:border-teal">
            <input type="hidden" name="bankId" value={b.id} />
            <div
              className="mx-auto mb-2.5 grid h-10 w-10 place-items-center rounded-xl text-[13px] font-bold text-white"
              style={{ backgroundColor: BANK_COLORS[b.id] ?? '#1B1F3B' }}
            >
              {b.код}
            </div>
            <div className="text-[13px] font-semibold">{b.банк}</div>
            <button type="submit" className="mt-1.5 text-[11px] font-semibold text-teal-700 hover:underline">
              Нажмите, чтобы подключить
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
