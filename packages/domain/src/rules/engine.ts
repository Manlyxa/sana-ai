import type { LocalDate } from '../kernel/local-date';
import type { CompanyContext } from './context';
import type { Finding, Rule, Severity } from './types';
import { ALL_RULES } from './all';

/**
 * Прогон правил. Чистый и детерминированный: одинаковый вход —
 * байт-в-байт одинаковый выход (идемпотентность перепрогона).
 * Лента отсортирована по тенге под риском — так её видит владелец.
 */

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

export function evaluateRules(
  ctx: CompanyContext,
  asOf: LocalDate,
  rules: readonly Rule[] = ALL_RULES,
): readonly Finding[] {
  return rules
    .flatMap((rule) => rule.evaluate(ctx, asOf))
    .sort((a, b) => {
      const byExposure = b.exposure.compareTo(a.exposure);
      if (byExposure !== 0) return byExposure;
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Сверка свежего прогона с уже известными находками.
 * Находка с тем же id — та же проблема: не создаётся заново (не «re-raised»);
 * исчезнувшая из свежего прогона — решена.
 */
export type FindingDiff = {
  readonly added: readonly Finding[];
  readonly retained: readonly Finding[];
  readonly resolved: readonly Finding[];
};

export function diffFindings(
  previous: readonly Finding[],
  current: readonly Finding[],
): FindingDiff {
  const prevIds = new Set(previous.map((f) => f.id));
  const currIds = new Set(current.map((f) => f.id));
  return {
    added: current.filter((f) => !prevIds.has(f.id)),
    retained: current.filter((f) => prevIds.has(f.id)),
    resolved: previous.filter((f) => !currIds.has(f.id)),
  };
}
