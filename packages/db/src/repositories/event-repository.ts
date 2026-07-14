import { asc, eq } from 'drizzle-orm';
import { all as allResults, err, ok, type BusinessEvent, type Result } from '@sana/domain';
import type { Db } from '../client';
import { businessEvents } from '../schema';
import { deserializeEvent, toJsonb } from '../codec';

/**
 * Персистентный теневой регистр (P8). Семантика обязана совпадать с
 * InMemoryBusinessEventStore: append-only, дубликат id отвергается.
 */

export type AppendError =
  | { kind: 'DUPLICATE_ID'; id: string }
  | { kind: 'IO'; message: string };

export class EventRepository {
  constructor(private readonly db: Db) {}

  async append(event: BusinessEvent): Promise<Result<BusinessEvent, AppendError>> {
    try {
      const inserted = await this.db
        .insert(businessEvents)
        .values({
          id: event.id,
          companyId: event.companyId,
          occurredAt: event.occurredAt.toISO(),
          type: event.type,
          payload: toJsonb(event.payload),
          sourceSystem: event.sourceSystem,
          sourceDocumentRef: event.sourceDocumentRef === null ? null : toJsonb(event.sourceDocumentRef),
          ingestedAt: event.ingestedAt.toISO(),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        return err({ kind: 'DUPLICATE_ID', id: event.id });
      }
      return ok(event);
    } catch (e) {
      return err({ kind: 'IO', message: String(e) });
    }
  }

  async appendAll(events: readonly BusinessEvent[]): Promise<Result<number, AppendError>> {
    let appended = 0;
    for (const event of events) {
      const r = await this.append(event);
      if (!r.ok) {
        if (r.error.kind === 'DUPLICATE_ID') continue; // идемпотентная повторная загрузка
        return r;
      }
      appended += 1;
    }
    return ok(appended);
  }

  /** События компании в порядке поступления, восстановленные в домен. */
  async forCompany(companyId: string): Promise<Result<readonly BusinessEvent[], string>> {
    const rows = await this.db
      .select()
      .from(businessEvents)
      .where(eq(businessEvents.companyId, companyId))
      .orderBy(asc(businessEvents.seq));
    return allResults(rows.map(deserializeEvent));
  }

  async count(companyId: string): Promise<number> {
    const rows = await this.db
      .select({ id: businessEvents.id })
      .from(businessEvents)
      .where(eq(businessEvents.companyId, companyId));
    return rows.length;
  }
}
