import { err, ok, type Result } from '../kernel/result';
import type { TaxPeriod } from '../kernel/tax-period';
import type { BusinessEvent, BusinessEventType } from './business-event';

/**
 * Append-only хранилище событий (P8). Эта чистая in-memory реализация —
 * эталон семантики; персистентная версия (фаза 6) обязана вести себя так же.
 */

export type AppendError = { readonly kind: 'DUPLICATE_ID'; readonly id: string };

export class InMemoryBusinessEventStore {
  private readonly events: BusinessEvent[] = [];
  private readonly ids = new Set<string>();

  append(event: BusinessEvent): Result<BusinessEvent, AppendError> {
    if (this.ids.has(event.id)) {
      return err({ kind: 'DUPLICATE_ID', id: event.id });
    }
    const frozen = Object.freeze({ ...event });
    this.events.push(frozen);
    this.ids.add(event.id);
    return ok(frozen);
  }

  appendAll(events: readonly BusinessEvent[]): Result<readonly BusinessEvent[], AppendError> {
    const appended: BusinessEvent[] = [];
    for (const e of events) {
      const r = this.append(e);
      if (!r.ok) return r;
      appended.push(r.value);
    }
    return ok(appended);
  }

  /** Все события в порядке поступления. */
  all(): readonly BusinessEvent[] {
    return [...this.events];
  }

  forCompany(companyId: string): readonly BusinessEvent[] {
    return this.events.filter((e) => e.companyId === companyId);
  }

  ofType<T extends BusinessEventType>(type: T): readonly BusinessEvent<T>[] {
    return this.events.filter((e): e is BusinessEvent<T> => e.type === type);
  }

  /** События, хозяйственная дата которых попадает в период. */
  inPeriod(period: TaxPeriod): readonly BusinessEvent[] {
    return this.events.filter((e) => period.contains(e.occurredAt));
  }

  get size(): number {
    return this.events.length;
  }
}
