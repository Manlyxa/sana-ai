import type { LocalDate } from '../kernel/local-date';
import type { LedgerLine, PostingAnalytics } from '../accounting/ledger-entry';
import { CHART_OF_ACCOUNTS_VERSION } from '../accounting/chart-of-accounts';
import type { LedgerEntryInput } from '../accounting/ledger-entry';

/**
 * PostingProposal — a proposed ledger entry produced by the posting
 * engine (Module 2). Monetary amounts in `lines` are always computed by
 * deterministic code from the source event; classifiers (heuristic or AI)
 * only ever suggest accounts, subledger analytics and a confidence score.
 */

export type ProposalOrigin =
  /** Подтверждённое пользователем правило (высший приоритет). */
  | 'LEARNED_RULE'
  /** Детерминированное правило для однозначных случаев. */
  | 'DETERMINISTIC'
  /** Эвристический классификатор (ключевые слова, КНП). */
  | 'HEURISTIC'
  /** Предложение AI-классификатора. */
  | 'AI';

/** Account/analytics suggestion — the only thing a classifier may produce. */
export type AccountSuggestion = {
  readonly debitAccount: string;
  readonly creditAccount: string;
  /** Статья доходов/расходов. */
  readonly category: string | null;
  /** Уверенность 0–100 (целое). */
  readonly confidence: number;
  /** Объяснение на русском — показывается пользователю в очереди. */
  readonly explanation: string;
};

export type PostingProposal = {
  readonly id: string;
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly date: LocalDate;
  /** Полные строки будущей проводки; суммы вычислены кодом из события. */
  readonly lines: readonly LedgerLine[];
  readonly memo: string;
  readonly analytics: PostingAnalytics;
  readonly origin: ProposalOrigin;
  /** id сработавшего подтверждённого правила (для LEARNED_RULE). */
  readonly ruleId: string | null;
  readonly confidence: number;
  readonly explanation: string;
  readonly norm: string | null;
};

export type RoutingDecision =
  /** Confidence ≥ threshold: post automatically (уровень A3). */
  | 'AUTO_POST'
  /** Otherwise: send to the human confirmation queue (уровень A2). */
  | 'CONFIRMATION_QUEUE';

/** Порог автопроводки в процентах (конфигурируемый). */
export const DEFAULT_AUTO_POST_THRESHOLD = 90;

export function decideRouting(
  proposal: PostingProposal,
  threshold: number = DEFAULT_AUTO_POST_THRESHOLD,
): RoutingDecision {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(`threshold must be an integer in [0, 100]: ${threshold}`);
  }
  return proposal.confidence >= threshold ? 'AUTO_POST' : 'CONFIRMATION_QUEUE';
}

/** Converts an accepted proposal into a ledger entry input (Module 1). */
export function toLedgerEntryInput(proposal: PostingProposal): LedgerEntryInput {
  return {
    id: `le-${proposal.sourceEventId}`,
    companyId: proposal.companyId,
    sourceEventId: proposal.sourceEventId,
    date: proposal.date,
    lines: proposal.lines,
    memo: proposal.memo,
    analytics: proposal.analytics,
    norm: proposal.norm,
    legalParamsVersion: CHART_OF_ACCOUNTS_VERSION,
    reversesEntryId: null,
  };
}

/** Replaces an account across the proposal lines («подтвердить с другим счётом»). */
export function replaceAccount(
  lines: readonly LedgerLine[],
  from: string,
  to: string,
): readonly LedgerLine[] {
  return lines.map((l) => (l.account === from ? { ...l, account: to } : l));
}
