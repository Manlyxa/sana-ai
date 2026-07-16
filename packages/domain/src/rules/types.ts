import type { Justification } from '../kernel/justification';
import type { LocalDate } from '../kernel/local-date';
import type { Money } from '../kernel/money';
import type { AutonomyLevel } from '../autonomy/autonomy-level';
import type { CompanyContext } from './context';

/**
 * Движок правил (§7) — сердце MVP.
 *
 * UI никогда не показывает находку как «задачу» — только как сумму денег
 * под риском: «Вы теряете 2 340 000 ₸ зачёта НДС, если не отправите
 * извещения до 15 мая». exposure обязателен у каждой находки.
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';

/** Что система может сделать с находкой — с уровнем автономности (P6). */
export type RemediationAction = {
  readonly kind: string;
  readonly description: string;
  readonly autonomyLevel: AutonomyLevel;
};

export type Finding = {
  /** Детерминированный id: `${ruleId}:${subjectId}` — основа идемпотентности. */
  readonly id: string;
  readonly ruleId: string;
  readonly companyId: string;
  readonly severity: Severity;
  readonly asOf: LocalDate;
  /** Деньги под риском — драйвер UI. */
  readonly exposure: Money;
  /** Объяснение простым русским языком. */
  readonly message: string;
  /** Норма, документы-основания, версия параметров (P3). */
  readonly justification: Justification;
  readonly remediation: RemediationAction;
};

export type Rule = {
  readonly id: string;
  readonly severity: Severity;
  readonly norm: string;
  readonly evaluate: (ctx: CompanyContext, asOf: LocalDate) => readonly Finding[];
  /** Суммарная экспозиция правила — для сортировки ленты рисков. */
  readonly financialExposure: (ctx: CompanyContext, asOf: LocalDate) => Money;
};

/** Собирает Rule из evaluate; financialExposure — сумма экспозиций находок. */
export function defineRule(spec: Omit<Rule, 'financialExposure'>): Rule {
  return {
    ...spec,
    financialExposure: (ctx, asOf) =>
      spec
        .evaluate(ctx, asOf)
        .reduce((acc, f) => acc.add(f.exposure), ctx.law.mrp.multiply(0)),
  };
}
