import {
  decideRouting,
  err,
  GeneralLedger,
  ok,
  patternFromEvent,
  proposePosting,
  replaceAccount,
  toLedgerEntryInput,
  DEFAULT_AUTO_POST_THRESHOLD,
  type BusinessEvent,
  type LearnedPostingRule,
  type LedgerEntry,
  type LocalDate,
  type PostingProposal,
  type Result,
  type TaxPeriod,
} from '@sana/domain';
import type { LlmPort } from '@sana/ports';
import { classifyWithAi } from './ai-classifier';
import { explainLedgerEntry, explainReportLine, type Explanation } from './explain';

/**
 * AccountingWorkspace (Modules 2–3): drives events through the posting
 * engine, auto-posts confident proposals (A3) and keeps the rest in a
 * human confirmation queue (A2). Confirmed decisions become reusable
 * learned rules that take precedence for future matching events.
 */

export type PendingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export type PendingOperation = {
  readonly id: string;
  readonly companyId: string;
  /** Исходное событие. */
  readonly event: BusinessEvent;
  /** Предложенная проводка с объяснением и confidence. */
  readonly proposal: PostingProposal;
  readonly status: PendingStatus;
  readonly resolution: {
    readonly resolvedBy: string;
    readonly resolvedAt: LocalDate;
    /** Причина отклонения (для REJECTED). */
    readonly reason: string | null;
    /** id созданной проводки (для CONFIRMED). */
    readonly ledgerEntryId: string | null;
  } | null;
};

export type ProcessOutcome =
  | { readonly kind: 'POSTED'; readonly entry: LedgerEntry; readonly proposal: PostingProposal }
  | { readonly kind: 'QUEUED'; readonly pending: PendingOperation }
  | { readonly kind: 'NO_ENTRY' };

export type WorkspaceError = { readonly message: string };

export type AccountingWorkspaceOptions = {
  /** Порог автопроводки в процентах. */
  readonly autoPostThreshold?: number;
  /** LLM-классификатор для неоднозначных операций (опционально). */
  readonly llm?: LlmPort;
};

export class AccountingWorkspace {
  readonly ledger: GeneralLedger;
  private readonly rules: LearnedPostingRule[] = [];
  private readonly queue = new Map<string, PendingOperation>();
  private readonly events = new Map<string, BusinessEvent>();
  private readonly threshold: number;
  private readonly llm: LlmPort | null;
  private ruleSeq = 0;

  constructor(
    readonly companyId: string,
    options: AccountingWorkspaceOptions = {},
  ) {
    this.ledger = new GeneralLedger(companyId);
    this.threshold = options.autoPostThreshold ?? DEFAULT_AUTO_POST_THRESHOLD;
    this.llm = options.llm ?? null;
  }

  learnedRules(): readonly LearnedPostingRule[] {
    return [...this.rules];
  }

  /** Очередь подтверждения: исходное событие, проводка, объяснение, confidence. */
  pendingOperations(): readonly PendingOperation[] {
    return [...this.queue.values()].filter((p) => p.status === 'PENDING');
  }

  operation(id: string): PendingOperation | null {
    return this.queue.get(id) ?? null;
  }

  /**
   * Runs an event through the engine: deterministic/learned proposals with
   * confidence ≥ threshold are posted automatically, the rest are queued.
   * The AI classifier is consulted only for ambiguous bank transactions.
   */
  async processEvent(event: BusinessEvent): Promise<Result<ProcessOutcome, WorkspaceError>> {
    this.events.set(event.id, event);
    let aiSuggestion = null;
    if (this.llm !== null && event.type === 'BANK_TRANSACTION') {
      aiSuggestion = await classifyWithAi(this.llm, event as BusinessEvent<'BANK_TRANSACTION'>);
    }
    const proposed = proposePosting(event, { learnedRules: this.rules, aiSuggestion });
    if (!proposed.ok) return err({ message: proposed.error.message });
    if (proposed.value === null) return ok({ kind: 'NO_ENTRY' });
    const proposal = proposed.value;

    if (decideRouting(proposal, this.threshold) === 'AUTO_POST') {
      const posted = this.ledger.post(toLedgerEntryInput(proposal));
      if (!posted.ok) return err({ message: posted.error.message });
      return ok({ kind: 'POSTED', entry: posted.value, proposal });
    }

    const pending: PendingOperation = {
      id: `po-${event.id}`,
      companyId: event.companyId,
      event,
      proposal,
      status: 'PENDING',
      resolution: null,
    };
    this.queue.set(pending.id, pending);
    return ok({ kind: 'QUEUED', pending });
  }

  /**
   * Документ (§8): предложение строится тем же движком (правила →
   * эвристики → подсказка OCR), но запись ВСЕГДА идёт в очередь
   * подтверждения — первичка не проводится без человека (A2).
   */
  queueDocument(
    event: BusinessEvent<'BANK_TRANSACTION'>,
    suggestion: {
      readonly debitAccount: string;
      readonly creditAccount: string;
      readonly category: string | null;
      readonly confidence: number;
      readonly explanation: string;
    },
  ): Result<PendingOperation, WorkspaceError> {
    this.events.set(event.id, event);
    const proposed = proposePosting(event, { learnedRules: this.rules, aiSuggestion: suggestion });
    if (!proposed.ok) return err({ message: proposed.error.message });
    if (proposed.value === null) {
      return err({ message: 'документ не порождает проводки' });
    }
    const pending: PendingOperation = {
      id: `po-${event.id}`,
      companyId: event.companyId,
      event,
      proposal: proposed.value,
      status: 'PENDING',
      resolution: null,
    };
    this.queue.set(pending.id, pending);
    return ok({ ...pending });
  }

  /** Подтвердить как есть. */
  confirm(
    pendingId: string,
    args: { readonly confirmedBy: string; readonly at: LocalDate },
  ): Result<{ entry: LedgerEntry; rule: LearnedPostingRule | null }, WorkspaceError> {
    return this.resolveConfirmed(pendingId, args, null);
  }

  /** Подтвердить, заменив предложенный счёт на выбранный пользователем. */
  confirmWithAccount(
    pendingId: string,
    args: {
      readonly confirmedBy: string;
      readonly at: LocalDate;
      /** Какой счёт из предложения заменить и на какой. */
      readonly fromAccount: string;
      readonly toAccount: string;
      readonly category?: string | null;
    },
  ): Result<{ entry: LedgerEntry; rule: LearnedPostingRule | null }, WorkspaceError> {
    return this.resolveConfirmed(pendingId, args, {
      fromAccount: args.fromAccount,
      toAccount: args.toAccount,
      category: args.category ?? null,
    });
  }

  /** Отклонить с указанием причины: проводка не создаётся, правило не создаётся. */
  reject(
    pendingId: string,
    args: { readonly rejectedBy: string; readonly at: LocalDate; readonly reason: string },
  ): Result<PendingOperation, WorkspaceError> {
    const pending = this.queue.get(pendingId);
    if (pending === undefined) return err({ message: `операция «${pendingId}» не найдена в очереди` });
    if (pending.status !== 'PENDING') return err({ message: `операция «${pendingId}» уже обработана` });
    if (args.reason.trim() === '') return err({ message: 'причина отклонения обязательна' });
    const resolved: PendingOperation = {
      ...pending,
      status: 'REJECTED',
      resolution: { resolvedBy: args.rejectedBy, resolvedAt: args.at, reason: args.reason, ledgerEntryId: null },
    };
    this.queue.set(pendingId, resolved);
    return ok(resolved);
  }

  private resolveConfirmed(
    pendingId: string,
    args: { readonly confirmedBy: string; readonly at: LocalDate },
    override: { fromAccount: string; toAccount: string; category: string | null } | null,
  ): Result<{ entry: LedgerEntry; rule: LearnedPostingRule | null }, WorkspaceError> {
    const pending = this.queue.get(pendingId);
    if (pending === undefined) return err({ message: `операция «${pendingId}» не найдена в очереди` });
    if (pending.status !== 'PENDING') return err({ message: `операция «${pendingId}» уже обработана` });

    let input = toLedgerEntryInput(pending.proposal);
    if (override !== null) {
      input = {
        ...input,
        lines: replaceAccount(input.lines, override.fromAccount, override.toAccount),
        analytics: { ...input.analytics, category: override.category ?? input.analytics.category },
      };
    }
    const posted = this.ledger.post(input);
    if (!posted.ok) return err({ message: posted.error.message });

    const rule = this.learnFrom(pending, posted.value, args);
    this.queue.set(pendingId, {
      ...pending,
      status: 'CONFIRMED',
      resolution: { resolvedBy: args.confirmedBy, resolvedAt: args.at, reason: null, ledgerEntryId: posted.value.id },
    });
    return ok({ entry: posted.value, rule });
  }

  /**
   * «Объясни эту цифру» (Module 5): проводка или строка отчёта →
   * Факт → Применённое правило → Результат, со ссылками на события,
   * нормы НК РК и версию правовых параметров.
   */
  explain(
    query:
      | { readonly kind: 'LEDGER_ENTRY'; readonly ledgerEntryId: string }
      | { readonly kind: 'REPORT_LINE'; readonly reportLineId: string; readonly period: TaxPeriod },
  ): Result<Explanation, WorkspaceError> {
    if (query.kind === 'LEDGER_ENTRY') {
      const entry = this.ledger.entry(query.ledgerEntryId);
      if (entry === null) return err({ message: `проводка «${query.ledgerEntryId}» не найдена` });
      return ok(explainLedgerEntry(entry, this.events.get(entry.sourceEventId) ?? null));
    }
    const explained = explainReportLine({
      lineId: query.reportLineId,
      entries: this.ledger.entries(),
      period: query.period,
    });
    return explained.ok ? explained : err({ message: explained.error });
  }

  /** Подтверждённое сопоставление банковской операции → многоразовое правило. */
  private learnFrom(
    pending: PendingOperation,
    entry: LedgerEntry,
    args: { readonly confirmedBy: string; readonly at: LocalDate },
  ): LearnedPostingRule | null {
    if (pending.event.type !== 'BANK_TRANSACTION') return null;
    const event = pending.event as BusinessEvent<'BANK_TRANSACTION'>;
    const debit = entry.lines.find((l) => l.side === 'DEBIT');
    const credit = entry.lines.find((l) => l.side === 'CREDIT');
    if (debit === undefined || credit === undefined) return null;
    this.ruleSeq += 1;
    const rule: LearnedPostingRule = {
      id: `rule-${this.companyId}-${this.ruleSeq}`,
      companyId: this.companyId,
      pattern: patternFromEvent(event),
      debitAccount: debit.account,
      creditAccount: credit.account,
      category: entry.analytics.category,
      createdFromEventId: event.id,
      confirmedBy: args.confirmedBy,
      createdAt: args.at,
    };
    this.rules.push(rule);
    return rule;
  }
}
