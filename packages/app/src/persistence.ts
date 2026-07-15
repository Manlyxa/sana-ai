import type {
  BusinessEvent,
  Finding,
  JournalEntry,
  LocalDate,
  Result,
  TaxRegisterEntry,
} from '@sana/domain';

/**
 * Интерфейсы персистентности для use-case'ов. @sana/app не зависит от
 * @sana/db: репозитории БД удовлетворяют этим интерфейсам структурно
 * (то же правило направления зависимостей, что и с портами — P5).
 */

export type AppendOutcome = Result<number, { readonly kind: string }>;

export type ComplianceRepos = {
  readonly events: {
    appendAll(events: readonly BusinessEvent[]): Promise<AppendOutcome>;
  };
  readonly ledger: {
    replaceJournal(companyId: string, entries: readonly JournalEntry[]): Promise<void>;
    replaceTaxRegisters(companyId: string, entries: readonly TaxRegisterEntry[]): Promise<void>;
  };
  readonly findings: {
    reconcileRun(
      companyId: string,
      current: readonly Finding[],
      asOf: LocalDate,
    ): Promise<{ added: number; retained: number; resolved: number }>;
    listOpen(companyId: string): Promise<Result<readonly Finding[], string>>;
  };
};
