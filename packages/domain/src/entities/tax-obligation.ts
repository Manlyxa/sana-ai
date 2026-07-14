import type { LocalDate } from '../kernel/local-date';
import type { Money } from '../kernel/money';
import type { TaxPeriod } from '../kernel/tax-period';
import { err, ok, type Result } from '../kernel/result';
import type { AutonomyLevel } from '../autonomy/autonomy-level';

export type TaxObligationKind =
  | 'ФНО_100'
  | 'ФНО_200'
  | 'ФНО_300'
  | 'ФНО_910'
  | 'НДС_ПЛАТЁЖ'
  | 'КПН_ПЛАТЁЖ'
  | 'ЗАРПЛАТНЫЕ_ПЛАТЕЖИ';

export type TaxObligationStatus =
  | 'PENDING'
  | 'PREPARED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'PAID'
  | 'OVERDUE';

export type TaxObligation = {
  readonly id: string;
  readonly companyId: string;
  readonly kind: TaxObligationKind;
  readonly period: TaxPeriod;
  readonly dueDate: LocalDate;
  /** null, пока сумма не исчислена. */
  readonly amount: Money | null;
  readonly status: TaxObligationStatus;
  /** ФНО и платёжки — всегда A1: без ЭЦП владельца не исполняются (P6). */
  readonly autonomyLevel: AutonomyLevel;
};

/**
 * Жизненный цикл обязательства. OVERDUE — не тупик: просроченное
 * обязательство всё равно доводится до исполнения.
 */
export const OBLIGATION_TRANSITIONS: Record<TaxObligationStatus, readonly TaxObligationStatus[]> = {
  PENDING: ['PREPARED', 'OVERDUE'],
  PREPARED: ['SIGNED', 'OVERDUE'],
  SIGNED: ['SUBMITTED', 'OVERDUE'],
  SUBMITTED: ['PAID', 'OVERDUE'],
  OVERDUE: ['PREPARED', 'SIGNED', 'SUBMITTED', 'PAID'],
  PAID: [],
};

export type ObligationTransitionError = {
  readonly from: TaxObligationStatus;
  readonly to: TaxObligationStatus;
  readonly message: string;
};

export function transitionObligation(
  obligation: TaxObligation,
  to: TaxObligationStatus,
): Result<TaxObligation, ObligationTransitionError> {
  const allowed = OBLIGATION_TRANSITIONS[obligation.status];
  if (!allowed.includes(to)) {
    return err({
      from: obligation.status,
      to,
      message: `переход ${obligation.status} → ${to} не допускается`,
    });
  }
  return ok({ ...obligation, status: to });
}

/** Просрочено ли обязательство на дату (ещё не исполнено, срок прошёл). */
export function isPastDue(obligation: TaxObligation, today: LocalDate): boolean {
  if (obligation.status === 'SUBMITTED' || obligation.status === 'PAID') return false;
  return today.isAfter(obligation.dueDate);
}
