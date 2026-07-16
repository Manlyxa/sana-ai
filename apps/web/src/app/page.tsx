import { ensureFirstRun, getCaller } from '../lib/server';
import { STR } from '../lib/i18n/ru';
import { tiynToTenge } from '../lib/format';
import { remediateAction, runCheckAction } from './actions';

export const dynamic = 'force-dynamic';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
type Autonomy = 'A0' | 'A1' | 'A2' | 'A3';

const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
  HIGH: 'bg-orange-100 text-orange-800 border-orange-200',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200',
  INFO: 'bg-stone-100 text-stone-600 border-stone-200',
};

const EXPOSURE_STYLE: Record<Severity, string> = {
  CRITICAL: 'text-red-700',
  HIGH: 'text-orange-700',
  MEDIUM: 'text-amber-700',
  INFO: 'text-stone-600',
};

export default async function RiskFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  await ensureFirstRun();
  const caller = await getCaller();
  const [company, feed, ledger] = await Promise.all([
    caller.company(),
    caller.riskFeed(),
    caller.ledger(),
  ]);
  const { notice } = await searchParams;

  const totalTiyn = feed.reduce((acc, f) => acc + BigInt(f.exposureTiyn), 0n);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{STR.appName}</h1>
            <p className="text-sm text-stone-500">
              {company.name} · БИН {company.bin} · {company.taxRegime} ·{' '}
              {company.vatRegistered ? STR.vatStatus.registered : STR.vatStatus.notRegistered} ·{' '}
              {company.employeeCount} {STR.employees}
            </p>
          </div>
          <form action={runCheckAction}>
            <button
              type="submit"
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-stone-50"
            >
              {STR.refreshCheck}
            </button>
          </form>
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-stone-500">{STR.totalAtRisk}</div>
          <div className="text-3xl font-bold tabular-nums text-red-700">
            {tiynToTenge(totalTiyn.toString())}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {feed.length} {STR.openFindings} ·{' '}
            {STR.ledgerLine(ledger.events, ledger.journalEntries, ledger.taxRegisterEntries)}
          </div>
        </div>

        {notice !== undefined && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {notice}
          </div>
        )}
      </header>

      {feed.length === 0 ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-800">
          {STR.emptyFeed}
        </p>
      ) : (
        <ul className="space-y-4">
          {feed.map((f) => {
            const severity = f.severity as Severity;
            const autonomy = f.remediation.autonomyLevel as Autonomy;
            return (
              <li key={f.id} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[severity]}`}
                  >
                    {STR.severity[severity]}
                  </span>
                  <span
                    className={`text-2xl font-bold tabular-nums ${EXPOSURE_STYLE[severity]}`}
                    title={STR.totalAtRisk}
                  >
                    {tiynToTenge(f.exposureTiyn)}
                  </span>
                </div>

                <p className="mt-3 text-[15px] leading-relaxed text-stone-800">{f.message}</p>

                <dl className="mt-3 space-y-1 text-xs text-stone-500">
                  <div>
                    <dt className="inline font-medium">{STR.norm}: </dt>
                    <dd className="inline">{f.norm}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">{STR.sourceDocuments}: </dt>
                    <dd className="inline">
                      {f.sourceDocuments.map((d) => `${d.documentType} ${d.documentId} (${d.system})`).join('; ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">{STR.parameterVersion}: </dt>
                    <dd className="inline font-mono">{f.parameterVersion}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-center justify-between gap-4 border-t border-stone-100 pt-3">
                  <div className="text-sm text-stone-600">
                    <span className="font-medium">{STR.remediation}: </span>
                    {f.remediation.description}{' '}
                    <span className="whitespace-nowrap rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-500">
                      {autonomy} · {STR.autonomy[autonomy]}
                    </span>
                  </div>
                  {autonomy === 'A0' ? (
                    <span className="shrink-0 text-sm text-stone-400">{STR.action.A0}</span>
                  ) : (
                    <form action={remediateAction} className="shrink-0">
                      <input type="hidden" name="findingId" value={f.id} />
                      <input type="hidden" name="autonomyLevel" value={autonomy} />
                      <button
                        type="submit"
                        className={
                          autonomy === 'A3'
                            ? 'rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700'
                            : autonomy === 'A2'
                              ? 'rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700'
                              : 'rounded-lg bg-stone-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800'
                        }
                      >
                        {STR.action[autonomy]}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
