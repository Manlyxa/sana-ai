import type { LocalDate } from '../kernel/local-date';
import { err, ok, type Result } from '../kernel/result';
import { TaxPeriod } from '../kernel/tax-period';
import {
  buildReversingEntry,
  createLedgerEntry,
  type LedgerEntry,
  type LedgerEntryError,
  type LedgerEntryInput,
} from './ledger-entry';

/**
 * GeneralLedger — append-only general ledger with monthly accounting
 * periods (Module 1).
 *
 * Period rules:
 *  - periods are calendar months, closed strictly in chronological order;
 *  - posting into a closed period is rejected — corrections go into an
 *    open period as reversing entries (`postCorrection`);
 *  - closed periods are never reopened (append-only history).
 */

export type PostError =
  | { readonly kind: 'INVALID_ENTRY'; readonly message: string }
  | { readonly kind: 'DUPLICATE_ID'; readonly message: string }
  | { readonly kind: 'PERIOD_CLOSED'; readonly message: string };

export type ClosePeriodError = { readonly message: string };

export class GeneralLedger {
  private readonly entryList: LedgerEntry[] = [];
  private readonly byId = new Map<string, LedgerEntry>();
  /** Последний закрытый месяц; всё до него включительно закрыто. */
  private closedThrough: TaxPeriod | null = null;

  constructor(readonly companyId: string) {}

  /** Периоды закрыты по этот месяц включительно (null — ничего не закрыто). */
  get closedThroughPeriod(): TaxPeriod | null {
    return this.closedThrough;
  }

  isPeriodClosed(period: TaxPeriod): boolean {
    if (period.kind !== 'MONTH') throw new Error('учётные периоды — только месячные');
    if (this.closedThrough === null) return false;
    return period.compareTo(this.closedThrough) <= 0;
  }

  /** Validates and appends a new entry; rejects postings into closed periods. */
  post(input: LedgerEntryInput): Result<LedgerEntry, PostError> {
    if (input.companyId !== this.companyId) {
      return err({ kind: 'INVALID_ENTRY', message: 'проводка относится к другой компании' });
    }
    const created = createLedgerEntry(input);
    if (!created.ok) return err({ kind: 'INVALID_ENTRY', message: created.error.message });
    const entry = created.value;
    if (this.byId.has(entry.id)) {
      return err({ kind: 'DUPLICATE_ID', message: `проводка с id «${entry.id}» уже существует` });
    }
    if (this.isPeriodClosed(entry.period)) {
      return err({
        kind: 'PERIOD_CLOSED',
        message: `период ${entry.period.code()} закрыт — исправление возможно только сторнирующей проводкой в открытом периоде`,
      });
    }
    this.entryList.push(entry);
    this.byId.set(entry.id, entry);
    return ok(entry);
  }

  /**
   * Historical correction: reverses `originalEntryId` with a new entry
   * dated `date` (must fall into an open period).
   */
  postCorrection(args: {
    readonly originalEntryId: string;
    readonly id: string;
    readonly date: LocalDate;
    readonly reason: string;
  }): Result<LedgerEntry, PostError | LedgerEntryError> {
    const original = this.byId.get(args.originalEntryId);
    if (original === undefined) {
      return err({ kind: 'INVALID_ENTRY' as const, message: `исходная проводка «${args.originalEntryId}» не найдена` });
    }
    const reversing = buildReversingEntry(original, args);
    if (!reversing.ok) return reversing;
    return this.post(reversing.value);
  }

  /**
   * Closes the next month in sequence. The first close may target any
   * month; afterwards months close strictly one after another.
   */
  closePeriod(period: TaxPeriod): Result<TaxPeriod, ClosePeriodError> {
    if (period.kind !== 'MONTH') {
      return err({ message: 'закрыть можно только месячный период' });
    }
    if (this.closedThrough !== null && !period.equals(this.closedThrough.next())) {
      return err({
        message: `периоды закрываются по порядку: следующий к закрытию — ${this.closedThrough.next().code()}`,
      });
    }
    this.closedThrough = period;
    return ok(period);
  }

  entry(id: string): LedgerEntry | null {
    return this.byId.get(id) ?? null;
  }

  /** Все проводки в порядке поступления. */
  entries(): readonly LedgerEntry[] {
    return [...this.entryList];
  }

  /** Проводки, хозяйственная дата которых попадает в период (любого вида). */
  entriesInPeriod(period: TaxPeriod): readonly LedgerEntry[] {
    return this.entryList.filter((e) => period.contains(e.date));
  }

  get size(): number {
    return this.entryList.length;
  }
}
