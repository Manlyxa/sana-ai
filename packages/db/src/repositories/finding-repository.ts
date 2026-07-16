import { and, desc, eq, isNull } from 'drizzle-orm';
import { all as allResults, type Finding, type LocalDate, type Result } from '@sana/domain';
import type { Db } from '../client';
import { findings } from '../schema';
import { deserializeFinding, moneyToRow, toJsonb } from '../codec';

/**
 * Хранилище находок. Сверка прогонов идемпотентна:
 * - новая находка → insert с firstDetectedAt = asOf;
 * - та же находка (тот же id) → обновляются данные, firstDetectedAt
 *   сохраняется — находка НЕ поднимается заново;
 * - исчезнувшая находка → resolvedAt = asOf (решена).
 */
export class FindingRepository {
  constructor(private readonly db: Db) {}

  async reconcileRun(
    companyId: string,
    current: readonly Finding[],
    asOf: LocalDate,
  ): Promise<{ added: number; retained: number; resolved: number }> {
    const openRows = await this.db
      .select({ id: findings.id })
      .from(findings)
      .where(and(eq(findings.companyId, companyId), isNull(findings.resolvedAt)));
    const openIds = new Set(openRows.map((r) => r.id));
    const currentIds = new Set(current.map((f) => f.id));

    let added = 0;
    let retained = 0;
    for (const f of current) {
      const money = moneyToRow(f.exposure);
      const values = {
        id: f.id,
        ruleId: f.ruleId,
        companyId: f.companyId,
        severity: f.severity,
        asOf: f.asOf.toISO(),
        exposureTiyn: money.amountTiyn,
        currency: money.currency,
        message: f.message,
        justification: toJsonb(f.justification),
        remediation: toJsonb(f.remediation),
        firstDetectedAt: asOf.toISO(),
        resolvedAt: null,
      };
      await this.db
        .insert(findings)
        .values(values)
        .onConflictDoUpdate({
          target: findings.id,
          // firstDetectedAt намеренно не трогаем; повторное появление
          // решённой находки открывает её заново (resolvedAt = null).
          set: {
            severity: values.severity,
            asOf: values.asOf,
            exposureTiyn: values.exposureTiyn,
            currency: values.currency,
            message: values.message,
            justification: values.justification,
            remediation: values.remediation,
            resolvedAt: null,
          },
        });
      if (openIds.has(f.id)) retained += 1;
      else added += 1;
    }

    let resolved = 0;
    for (const id of openIds) {
      if (!currentIds.has(id)) {
        await this.db.update(findings).set({ resolvedAt: asOf.toISO() }).where(eq(findings.id, id));
        resolved += 1;
      }
    }
    return { added, retained, resolved };
  }

  /** Открытые находки — лента рисков, по убыванию тенге под риском. */
  async listOpen(companyId: string): Promise<Result<readonly Finding[], string>> {
    const rows = await this.db
      .select()
      .from(findings)
      .where(and(eq(findings.companyId, companyId), isNull(findings.resolvedAt)))
      .orderBy(desc(findings.exposureTiyn));
    return allResults(rows.map(deserializeFinding));
  }

  async getOpen(findingId: string): Promise<Result<Finding, string> | null> {
    const rows = await this.db
      .select()
      .from(findings)
      .where(and(eq(findings.id, findingId), isNull(findings.resolvedAt)));
    const row = rows[0];
    if (row === undefined) return null;
    return deserializeFinding(row);
  }
}
