import type { DocRef } from '../kernel/justification';
import { createJustification } from '../kernel/justification';
import { daysInMonth, LocalDate } from '../kernel/local-date';
import type { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import type { CompanyContext } from './context';
import type { Finding, RemediationAction, Severity } from './types';

/** «День D месяца через N месяцев после конца периода» (сроки ФНО). */
export function periodOffsetDate(
  periodEnd: LocalDate,
  offset: { readonly monthsAfterPeriodEnd: number; readonly dayOfMonth: number },
): LocalDate {
  const base = periodEnd.plusMonths(offset.monthsAfterPeriodEnd);
  const day = Math.min(offset.dayOfMonth, daysInMonth(base.year, base.month));
  return LocalDate.of(base.year, base.month, day);
}

/** «2 340 000 ₸» — суммы в сообщениях для владельца. */
export function formatTenge(money: Money): string {
  const [wholePart] = money.toDecimalString().split('.');
  const whole = wholePart as string;
  const sign = whole.startsWith('-') ? '−' : '';
  const digits = whole.replace('-', '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped} ₸`;
}

type FindingSpec = {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly norm: string;
  readonly subjectId: string;
  readonly exposure: Money;
  readonly message: string;
  readonly sourceDocuments: readonly DocRef[];
  readonly remediation: RemediationAction;
};

/** Находка с детерминированным id и полным Justification (P3). */
export function makeFinding(ctx: CompanyContext, asOf: LocalDate, spec: FindingSpec): Finding {
  return {
    id: `${spec.ruleId}:${spec.subjectId}`,
    ruleId: spec.ruleId,
    companyId: ctx.company.id,
    severity: spec.severity,
    asOf,
    exposure: spec.exposure,
    message: spec.message,
    justification: unwrap(
      createJustification({
        norm: spec.norm,
        sourceDocuments: spec.sourceDocuments,
        parameterVersion: ctx.law.version,
        explanation: spec.message,
      }),
    ),
    remediation: spec.remediation,
  };
}

export function invoiceDocRef(number: string): DocRef {
  return { system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: number };
}
