import { err, ok, type LocalDate, type Result } from '@sana/domain';
import type { LegalParameter, ParamKey, ResolveError } from './types';

/** Запись при регистрации: version вычисляется хранилищем. */
export type LegalParameterInput<T> = Omit<LegalParameter<T>, 'version'>;

export type StoreConstructionError = {
  kind: 'OVERLAP' | 'INVALID_INTERVAL';
  key: string;
  message: string;
};

/**
 * Темпоральное хранилище правовых параметров (P2).
 * Любой расчёт за период P обязан разрешать параметры на дату из P,
 * никогда — «текущие».
 */
export class LegalParameterStore {
  private constructor(
    private readonly byKey: ReadonlyMap<string, readonly LegalParameter<unknown>[]>,
  ) {}

  /** Проверяет корректность интервалов и отсутствие пересечений по каждому ключу. */
  static create(
    inputs: readonly LegalParameterInput<unknown>[],
  ): Result<LegalParameterStore, StoreConstructionError[]> {
    const byKey = new Map<string, LegalParameter<unknown>[]>();
    for (const input of inputs) {
      const record: LegalParameter<unknown> = {
        ...input,
        version: `${input.key}@${input.validFrom.toISO()}`,
      };
      const list = byKey.get(record.key);
      if (list === undefined) {
        byKey.set(record.key, [record]);
      } else {
        list.push(record);
      }
    }

    const errors: StoreConstructionError[] = [];
    for (const [key, records] of byKey) {
      records.sort((a, b) => a.validFrom.compareTo(b.validFrom));
      for (let i = 0; i < records.length; i++) {
        const current = records[i] as LegalParameter<unknown>;
        if (current.validTo !== null && current.validTo.isBefore(current.validFrom)) {
          errors.push({
            kind: 'INVALID_INTERVAL',
            key,
            message: `validTo ${current.validTo.toISO()} раньше validFrom ${current.validFrom.toISO()}`,
          });
        }
        const next = records[i + 1];
        if (next !== undefined) {
          if (current.validTo === null || !current.validTo.isBefore(next.validFrom)) {
            errors.push({
              kind: 'OVERLAP',
              key,
              message: `интервалы пересекаются: ${current.version} и ${next.version}`,
            });
          }
        }
      }
    }
    if (errors.length > 0) return err(errors);
    return ok(new LegalParameterStore(byKey));
  }

  resolve<T>(key: ParamKey<T>, asOf: LocalDate): Result<LegalParameter<T>, ResolveError> {
    const records = this.byKey.get(key.id);
    if (records === undefined) return err({ kind: 'UNKNOWN_KEY', key: key.id });
    for (const record of records) {
      if (asOf.isWithin(record.validFrom, record.validTo)) {
        return ok(record as LegalParameter<T>);
      }
    }
    return err({ kind: 'NOT_IN_EFFECT', key: key.id, asOf: asOf.toISO() });
  }

  /** Все версии параметра — для отображения истории закона. */
  history(keyId: string): readonly LegalParameter<unknown>[] {
    return this.byKey.get(keyId) ?? [];
  }

  /** Параметры, требующие подтверждения экспертом (§10). */
  todoVerify(): readonly LegalParameter<unknown>[] {
    const result: LegalParameter<unknown>[] = [];
    for (const records of this.byKey.values()) {
      for (const r of records) if (r.todoVerify) result.push(r);
    }
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }

  keys(): readonly string[] {
    return [...this.byKey.keys()].sort();
  }
}
