import type { LocalDate } from '../kernel/local-date';
import type { BankTransactionPayload, BusinessEvent } from '../ledger/business-event';

/**
 * Learned posting rules (Module 2): every mapping confirmed by the user
 * («операция такого вида → счёт») becomes a deterministic, reusable rule
 * that takes precedence over built-in heuristics for future events.
 *
 * MVP learning scope: bank transactions — the only genuinely ambiguous
 * event class (ЭСФ и чеки ОФД разносятся детерминированно).
 */

export type PostingRulePattern = {
  readonly direction: 'CREDIT' | 'DEBIT';
  /** Код назначения платежа; null — не участвует в сопоставлении. */
  readonly knp: string | null;
  readonly counterpartyBin: string | null;
  /** Подстрока назначения платежа в нижнем регистре; null — не участвует. */
  readonly purposeContains: string | null;
};

export type LearnedPostingRule = {
  readonly id: string;
  readonly companyId: string;
  readonly pattern: PostingRulePattern;
  readonly debitAccount: string;
  readonly creditAccount: string;
  readonly category: string | null;
  /** Событие, подтверждение которого породило правило. */
  readonly createdFromEventId: string;
  readonly confirmedBy: string;
  readonly createdAt: LocalDate;
};

export function matchesPattern(pattern: PostingRulePattern, payload: BankTransactionPayload): boolean {
  if (pattern.direction !== payload.direction) return false;
  if (pattern.knp !== null && pattern.knp !== payload.knp) return false;
  if (pattern.counterpartyBin !== null && pattern.counterpartyBin !== (payload.counterpartyBin?.value ?? null)) {
    return false;
  }
  if (
    pattern.purposeContains !== null &&
    !payload.purposeText.toLowerCase().includes(pattern.purposeContains)
  ) {
    return false;
  }
  return true;
}

function specificity(pattern: PostingRulePattern): number {
  return (
    (pattern.knp !== null ? 1 : 0) +
    (pattern.counterpartyBin !== null ? 1 : 0) +
    (pattern.purposeContains !== null ? 1 : 0)
  );
}

/**
 * Deterministic rule lookup: the most specific matching rule wins; on a
 * tie, the most recently confirmed one (later in the list) wins.
 */
export function findLearnedRule(
  rules: readonly LearnedPostingRule[],
  event: BusinessEvent<'BANK_TRANSACTION'>,
): LearnedPostingRule | null {
  let best: LearnedPostingRule | null = null;
  let bestSpecificity = -1;
  for (const rule of rules) {
    if (rule.companyId !== event.companyId) continue;
    if (!matchesPattern(rule.pattern, event.payload)) continue;
    const s = specificity(rule.pattern);
    if (s >= bestSpecificity) {
      best = rule;
      bestSpecificity = s;
    }
  }
  return best;
}

/**
 * Derives a reusable pattern from a confirmed event: КНП + контрагент when
 * available, otherwise the normalized payment purpose text.
 */
export function patternFromEvent(event: BusinessEvent<'BANK_TRANSACTION'>): PostingRulePattern {
  const p = event.payload;
  const bin = p.counterpartyBin?.value ?? null;
  if (p.knp !== null || bin !== null) {
    return { direction: p.direction, knp: p.knp, counterpartyBin: bin, purposeContains: null };
  }
  const purpose = p.purposeText.trim().toLowerCase();
  return {
    direction: p.direction,
    knp: null,
    counterpartyBin: null,
    purposeContains: purpose === '' ? null : purpose,
  };
}
