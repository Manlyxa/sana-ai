import { daysBetween, Money, type Result } from '@sana/domain';
import { runAndPersistComplianceCheck, type PersistedCheckSummary } from '@sana/app';
import type { PortError } from '@sana/ports';
import type { WorkerDeps } from './deps';

/**
 * Обработчики заданий — чистые функции над зависимостями (P1): полностью
 * тестируются без Redis. BullMQ-обвязка (queues.ts, main.ts) лишь вызывает их.
 */

/** Сердцебиение: полная комплаенс-проверка по расписанию. */
export async function handleComplianceHeartbeat(
  deps: WorkerDeps,
): Promise<Result<PersistedCheckSummary, PortError>> {
  return runAndPersistComplianceCheck(deps.ports, deps.repos, {
    company: deps.company,
    accountIban: deps.accountIban,
    law: deps.law,
    asOf: deps.today,
  });
}

export type RiskDigest = {
  readonly openFindings: number;
  readonly criticalFindings: number;
  readonly totalExposureTiyn: string;
  /** Находки со сроком в ближайшие N дней — кандидаты на уведомление владельцу. */
  readonly dueSoon: readonly { id: string; message: string; exposureTiyn: string }[];
};

/** Мониторинг дедлайнов: свод открытых рисков для утреннего уведомления. */
export async function handleRiskDigest(
  deps: WorkerDeps,
  dueSoonWindowDays = 7,
): Promise<Result<RiskDigest, { message: string }>> {
  const open = await deps.repos.findings.listOpen(deps.company.id);
  if (!open.ok) return { ok: false, error: { message: open.error } };
  const total = open.value.reduce((acc, f) => acc.add(f.exposure), Money.zero());
  const dueSoon = open.value
    .filter((f) => {
      // Находки с приближающимся сроком: MEDIUM/HIGH со свежей датой оценки
      // либо явные «*_APPROACHING». Простая эвристика MVP.
      return f.ruleId.endsWith('_APPROACHING') || daysBetween(deps.today, f.asOf) <= dueSoonWindowDays;
    })
    .map((f) => ({ id: f.id, message: f.message, exposureTiyn: f.exposure.amount.toString() }));
  return {
    ok: true,
    value: {
      openFindings: open.value.length,
      criticalFindings: open.value.filter((f) => f.severity === 'CRITICAL').length,
      totalExposureTiyn: total.amount.toString(),
      dueSoon,
    },
  };
}
