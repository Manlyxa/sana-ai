import { grossTotal } from '../entities/invoice';
import type { Money } from '../kernel/money';
import { err, ok, type Result } from '../kernel/result';
import type { BusinessEvent } from '../ledger/business-event';
import type { LedgerLine, PostingAnalytics } from '../accounting/ledger-entry';
import { classifyBankTransaction } from './heuristics';
import { findLearnedRule, type LearnedPostingRule } from './learned-rules';
import type { AccountSuggestion, PostingProposal, ProposalOrigin } from './proposal';

/**
 * Posting engine (Module 2): BusinessEvent → PostingProposal.
 *
 * Precedence (deterministic, in this order):
 *  1. learned rules confirmed by the user;
 *  2. built-in deterministic rules (ЭСФ, чеки ОФД, однозначные КНП);
 *  3. keyword heuristics;
 *  4. an externally supplied AI suggestion (`aiSuggestion`) — used only
 *     when nothing above matched. The engine itself never calls an LLM,
 *     and no path lets a classifier decide a monetary amount.
 */

export type ProposePostingError = { readonly message: string };

export type ProposePostingOptions = {
  readonly learnedRules?: readonly LearnedPostingRule[];
  /** Предложение AI-классификатора (получено вне домена через LlmPort). */
  readonly aiSuggestion?: AccountSuggestion | null;
};

function pairLines(suggestion: { debitAccount: string; creditAccount: string }, amount: Money): readonly LedgerLine[] {
  return [
    { account: suggestion.debitAccount, side: 'DEBIT', amount },
    { account: suggestion.creditAccount, side: 'CREDIT', amount },
  ];
}

function proposal(
  event: BusinessEvent,
  args: {
    lines: readonly LedgerLine[];
    memo: string;
    analytics: PostingAnalytics;
    origin: ProposalOrigin;
    ruleId?: string | null;
    confidence: number;
    explanation: string;
    norm?: string | null;
  },
): PostingProposal {
  return {
    id: `pp-${event.id}`,
    companyId: event.companyId,
    sourceEventId: event.id,
    date: event.occurredAt,
    lines: args.lines,
    memo: args.memo,
    analytics: args.analytics,
    origin: args.origin,
    ruleId: args.ruleId ?? null,
    confidence: args.confidence,
    explanation: args.explanation,
    norm: args.norm ?? null,
  };
}

/**
 * Proposes a ledger entry for an event; `ok(null)` means the event kind
 * produces no accounting entry (кадровые и статусные события).
 */
export function proposePosting(
  event: BusinessEvent,
  options: ProposePostingOptions = {},
): Result<PostingProposal | null, ProposePostingError> {
  switch (event.type) {
    case 'ESF_ISSUED': {
      const { invoice } = (event as BusinessEvent<'ESF_ISSUED'>).payload;
      const lines: LedgerLine[] = [
        { account: '1210', side: 'DEBIT', amount: grossTotal(invoice) },
        { account: '6010', side: 'CREDIT', amount: invoice.totalExVat },
      ];
      if (invoice.vatAmount.isPositive()) {
        lines.push({ account: '3130', side: 'CREDIT', amount: invoice.vatAmount });
      }
      return ok(
        proposal(event, {
          lines,
          memo: `Реализация по ЭСФ № ${invoice.number} (${invoice.counterpartyName})`,
          analytics: {
            counterpartyBin: invoice.counterpartyBin.value,
            counterpartyName: invoice.counterpartyName,
            category: 'ВЫРУЧКА',
          },
          origin: 'DETERMINISTIC',
          confidence: 100,
          explanation: 'Исходящая ЭСФ — реализация: Дт 1210 Кт 6010, НДС — Кт 3130.',
          norm: 'ст. 412 НК РК',
        }),
      );
    }
    case 'ESF_RECEIVED': {
      const { invoice } = (event as BusinessEvent<'ESF_RECEIVED'>).payload;
      const lines: LedgerLine[] = [
        { account: '1330', side: 'DEBIT', amount: invoice.totalExVat },
      ];
      if (invoice.vatAmount.isPositive()) {
        lines.push({ account: '1420', side: 'DEBIT', amount: invoice.vatAmount });
      }
      lines.push({ account: '3310', side: 'CREDIT', amount: grossTotal(invoice) });
      return ok(
        proposal(event, {
          lines,
          memo: `Приобретение по ЭСФ № ${invoice.number} (${invoice.counterpartyName})`,
          analytics: {
            counterpartyBin: invoice.counterpartyBin.value,
            counterpartyName: invoice.counterpartyName,
            category: 'ЗАКУП',
          },
          origin: 'DETERMINISTIC',
          confidence: 100,
          explanation: 'Входящая ЭСФ — приобретение: Дт 1330 (НДС — Дт 1420) Кт 3310.',
          norm: 'ст. 400 НК РК',
        }),
      );
    }
    case 'OFD_RECEIPT': {
      const p = (event as BusinessEvent<'OFD_RECEIPT'>).payload;
      const net = p.total.subtract(p.vatAmount);
      if (!net.isPositive()) {
        return err({ message: `чек ОФД ${p.receiptId}: сумма без НДС должна быть > 0` });
      }
      const lines: LedgerLine[] = [
        { account: '1010', side: 'DEBIT', amount: p.total },
        { account: '6010', side: 'CREDIT', amount: net },
      ];
      if (p.vatAmount.isPositive()) {
        lines.push({ account: '3130', side: 'CREDIT', amount: p.vatAmount });
      }
      return ok(
        proposal(event, {
          lines,
          memo: `Розничная выручка по чеку ОФД № ${p.receiptId} (ККМ ${p.kkmRegistrationNumber})`,
          analytics: { counterpartyBin: null, counterpartyName: null, category: 'РОЗНИЦА' },
          origin: 'DETERMINISTIC',
          confidence: 100,
          explanation: 'Фискальный чек ОФД — розничная выручка: Дт 1010 Кт 6010, НДС — Кт 3130.',
          norm: 'ст. 166 НК РК',
        }),
      );
    }
    case 'BANK_TRANSACTION': {
      const bankEvent = event as BusinessEvent<'BANK_TRANSACTION'>;
      const p = bankEvent.payload;
      const analytics: PostingAnalytics = {
        counterpartyBin: p.counterpartyBin?.value ?? null,
        counterpartyName: p.counterpartyName,
        category: null,
      };
      const memo = p.direction === 'CREDIT' ? `Поступление: ${p.purposeText}` : `Списание: ${p.purposeText}`;

      const learned = findLearnedRule(options.learnedRules ?? [], bankEvent);
      if (learned !== null) {
        return ok(
          proposal(event, {
            lines: pairLines(learned, p.amount),
            memo,
            analytics: { ...analytics, category: learned.category },
            origin: 'LEARNED_RULE',
            ruleId: learned.id,
            confidence: 100,
            explanation: `Применено подтверждённое вами правило: Дт ${learned.debitAccount} Кт ${learned.creditAccount}.`,
          }),
        );
      }

      const heuristic = classifyBankTransaction(p);
      if (heuristic.deterministic) {
        return ok(
          proposal(event, {
            lines: pairLines(heuristic, p.amount),
            memo,
            analytics: { ...analytics, category: heuristic.category },
            origin: 'DETERMINISTIC',
            confidence: heuristic.confidence,
            explanation: heuristic.explanation,
          }),
        );
      }

      const ai = options.aiSuggestion ?? null;
      const chosen: AccountSuggestion = ai !== null && ai.confidence > heuristic.confidence ? ai : heuristic;
      return ok(
        proposal(event, {
          lines: pairLines(chosen, p.amount),
          memo,
          analytics: { ...analytics, category: chosen.category },
          origin: chosen === ai ? 'AI' : 'HEURISTIC',
          confidence: chosen.confidence,
          explanation: chosen.explanation,
        }),
      );
    }
    // Кадровые и статусные события не порождают проводок.
    case 'ESF_STATUS_CHANGED':
    case 'EMPLOYEE_HIRED':
    case 'EMPLOYEE_TERMINATED':
      return ok(null);
  }
}
