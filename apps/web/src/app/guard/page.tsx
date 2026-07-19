import { getCaller } from '../../lib/server';
import { tiynToTenge } from '../../lib/format';
import { STR } from '../../lib/i18n/ru';
import { remediateAction, resolveFindingAction, runCheckAction } from '../actions';

export const dynamic = 'force-dynamic';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
type Autonomy = 'A0' | 'A1' | 'A2' | 'A3';

const SEV_BAR: Record<Severity, string> = {
  CRITICAL: 'bg-coral',
  HIGH: 'bg-amber-mock',
  MEDIUM: 'bg-teal',
  INFO: 'bg-slate-light',
};

const SEV_TAG: Record<Severity, string> = {
  CRITICAL: 'bg-coral-050 text-red-700',
  HIGH: 'bg-amber-050 text-amber-700',
  MEDIUM: 'bg-teal-050 text-teal-700',
  INFO: 'bg-stone-100 text-slate-mock',
};

/**
 * Sana Guard (§3): лента открытых рисков — каждая находка несёт тенге под
 * риском, норму НК и документы-основания. «Решено» — реальная смена
 * статуса в реестре находок.
 */
export default async function GuardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const caller = await getCaller();
  const feed = await caller.riskFeed();
  const { notice } = await searchParams;
  const totalTiyn = feed.reduce((acc, f) => acc + BigInt(f.exposureTiyn), 0n);

  return (
    <section>
      <p className="page-sub">Ни одного пропущенного срока. Ни одного потерянного вычета.</p>

      <div className="flex items-center justify-between rounded-t-2xl border border-b-0 border-border-mock bg-white px-4.5 p-4">
        <div>
          <h3 className="text-[15px] font-semibold">Открытые риски</h3>
          <p className="text-[11.5px] text-slate-mock">
            {feed.length} находок · отсортированы по сумме под риском
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] text-slate-mock">{STR.totalAtRisk}</div>
            <div className="text-xl font-semibold tabular-nums text-coral">
              {tiynToTenge(totalTiyn.toString())}
            </div>
          </div>
          <form action={runCheckAction}>
            <button type="submit" className="btn-ghost !px-3 !py-1.5 text-[12px]">
              {STR.refreshCheck}
            </button>
          </form>
        </div>
      </div>

      {notice !== undefined && (
        <div className="border border-b-0 border-border-mock bg-teal-050 px-4 py-3 text-sm">{notice}</div>
      )}

      <div className="listcard rounded-t-none">
        {feed.length === 0 ? (
          <div className="p-8 text-center text-sm text-green-700">{STR.emptyFeed}</div>
        ) : (
          feed.map((f) => {
            const severity = f.severity as Severity;
            const autonomy = f.remediation.autonomyLevel as Autonomy;
            return (
              <div key={f.id} className="flex gap-3.5 border-b border-border-soft p-4 last:border-b-0">
                <div className={`w-1 flex-shrink-0 rounded ${SEV_BAR[severity]}`} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${SEV_TAG[severity]}`}>
                      {STR.severity[severity]}
                    </span>
                    <span className="text-sm font-semibold">{f.ruleId}</span>
                  </div>
                  <p className="mb-2 text-[12.5px] leading-relaxed text-slate-mock">{f.message}</p>
                  <div className="flex flex-wrap gap-3.5 text-[11px] text-slate-light">
                    <span>Норма: {f.norm}</span>
                    <span>
                      Документы:{' '}
                      {f.sourceDocuments.map((d) => `${d.documentType} ${d.documentId}`).join('; ')}
                    </span>
                  </div>
                  <div className="mt-2 text-[12px] text-slate-mock">
                    <b>{STR.remediation}:</b> {f.remediation.description}{' '}
                    <span className="rounded bg-stone-100 px-1.5 py-px font-mono text-[10.5px] text-slate-light">
                      {autonomy} · {STR.autonomy[autonomy]}
                    </span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <div className="text-[17px] font-semibold tabular-nums text-coral">
                    {f.exposureTiyn === '0' ? '—' : tiynToTenge(f.exposureTiyn)}
                  </div>
                  {autonomy !== 'A0' && (
                    <form action={remediateAction}>
                      <input type="hidden" name="findingId" value={f.id} />
                      <input type="hidden" name="autonomyLevel" value={autonomy} />
                      <button
                        type="submit"
                        className={
                          autonomy === 'A1'
                            ? 'btn !px-3 !py-1.5 bg-indigo-deep text-[12px] text-white hover:brightness-110'
                            : 'btn-primary !px-3 !py-1.5 text-[12px]'
                        }
                      >
                        {STR.action[autonomy]}
                      </button>
                    </form>
                  )}
                  <form action={resolveFindingAction}>
                    <input type="hidden" name="findingId" value={f.id} />
                    <button
                      type="submit"
                      className="text-[11.5px] font-semibold text-slate-light hover:text-green-700"
                    >
                      ✓ Решено
                    </button>
                  </form>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
