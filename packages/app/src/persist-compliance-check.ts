import { err, ok, type Result } from '@sana/domain';
import type { PortError } from '@sana/ports';
import { runComplianceCheck, type ComplianceCheckInput, type CompliancePorts } from './compliance-check';
import type { ComplianceRepos } from './persistence';

/**
 * Сердцебиение продукта: прогнать комплаенс-проверку и сохранить результат.
 * Идемпотентно: события не дублируются, находки сверяются, проекции
 * пересобираются. Используется API (по запросу) и worker'ом (по расписанию).
 */

export type PersistedCheckSummary = {
  readonly eventsIngested: number;
  readonly journalEntries: number;
  readonly taxRegisterEntries: number;
  readonly findings: { readonly added: number; readonly retained: number; readonly resolved: number };
  /** Строка: сводка пересекает границы процессов (очередь) как JSON. */
  readonly openExposureTiyn: string;
};

export async function runAndPersistComplianceCheck(
  ports: CompliancePorts,
  repos: ComplianceRepos,
  input: ComplianceCheckInput,
): Promise<Result<PersistedCheckSummary, PortError>> {
  const result = await runComplianceCheck(ports, input);
  if (!result.ok) return result;
  const { eventStore, journal, taxRegisters, findings } = result.value;

  const appended = await repos.events.appendAll(eventStore.all());
  if (!appended.ok) {
    return err({ kind: 'IO', message: `сохранение событий: ${appended.error.kind}` });
  }
  await repos.ledger.replaceJournal(input.company.id, journal);
  await repos.ledger.replaceTaxRegisters(input.company.id, taxRegisters);
  const reconciled = await repos.findings.reconcileRun(input.company.id, findings, input.asOf);

  const openExposureTiyn = findings.reduce((acc, f) => acc + f.exposure.amount, 0n);
  return ok({
    eventsIngested: appended.value,
    journalEntries: journal.length,
    taxRegisterEntries: taxRegisters.length,
    findings: reconciled,
    openExposureTiyn: openExposureTiyn.toString(),
  });
}
