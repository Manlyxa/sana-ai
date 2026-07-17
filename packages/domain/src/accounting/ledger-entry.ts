import type { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import { err, ok, type Result } from '../kernel/result';
import { TaxPeriod } from '../kernel/tax-period';
import { isKnownAccount } from './chart-of-accounts';

/**
 * LedgerEntry — проводка главной книги (двойная запись) with subledger
 * analytics and full provenance (Module 5): every entry references its
 * source event, the applicable Tax Code norm (when relevant) and the
 * legal-parameters version used to produce it.
 *
 * Entries are immutable and append-only; corrections are represented as
 * reversing entries referencing the original (`reversesEntryId`).
 */

export type LedgerSide = 'DEBIT' | 'CREDIT';

/** Subledger analytics attached to an entry. */
export type PostingAnalytics = {
  /** БИН/ИИН контрагента, если известен. */
  readonly counterpartyBin: string | null;
  readonly counterpartyName: string | null;
  /** Статья доходов/расходов (категория аналитического учёта). */
  readonly category: string | null;
};

export const EMPTY_ANALYTICS: PostingAnalytics = {
  counterpartyBin: null,
  counterpartyName: null,
  category: null,
};

export type LedgerLine = {
  readonly account: string;
  readonly side: LedgerSide;
  readonly amount: Money;
};

export type LedgerEntry = {
  readonly id: string;
  readonly companyId: string;
  /** Источник (BusinessEvent), проекцией которого является проводка. */
  readonly sourceEventId: string;
  readonly date: LocalDate;
  /** Месячный учётный период, вычисляется из даты. */
  readonly period: TaxPeriod;
  readonly lines: readonly LedgerLine[];
  /** Описание операции — на русском, для владельца бизнеса. */
  readonly memo: string;
  readonly analytics: PostingAnalytics;
  /** Норма права («ст. 688 НК РК») — null, если не применима. */
  readonly norm: string | null;
  /** Версия правовых параметров/плана счетов: «chart-of-accounts.snr@2026-01-01». */
  readonly legalParamsVersion: string;
  /** id исходной проводки, если это сторнирующая (корректирующая) запись. */
  readonly reversesEntryId: string | null;
};

export type LedgerEntryInput = Omit<LedgerEntry, 'period'>;

export type LedgerEntryError = { readonly message: string };

/** Validates the double-entry invariant and account codes; derives the period. */
export function createLedgerEntry(
  input: LedgerEntryInput,
): Result<LedgerEntry, LedgerEntryError> {
  if (input.id.trim() === '') return err({ message: 'id проводки обязателен' });
  if (input.companyId.trim() === '') return err({ message: 'companyId обязателен' });
  if (input.sourceEventId.trim() === '') {
    return err({ message: 'проводка должна ссылаться на событие-основание (sourceEventId)' });
  }
  if (input.lines.length < 2) {
    return err({ message: 'проводка должна иметь минимум две строки (Дт и Кт)' });
  }
  const currency = (input.lines[0] as LedgerLine).amount.currency;
  let debit = Money.zero(currency);
  let credit = Money.zero(currency);
  for (const line of input.lines) {
    if (!isKnownAccount(line.account)) {
      return err({ message: `неизвестный счёт «${line.account}» — отсутствует в рабочем плане счетов` });
    }
    if (line.amount.currency !== currency) {
      return err({ message: 'все строки проводки должны быть в одной валюте' });
    }
    if (!line.amount.isPositive()) {
      return err({ message: `сумма строки должна быть > 0 (счёт ${line.account})` });
    }
    if (line.side === 'DEBIT') debit = debit.add(line.amount);
    else credit = credit.add(line.amount);
  }
  if (!debit.equals(credit)) {
    return err({
      message: `проводка не сбалансирована: Дт ${debit.toDecimalString()} ≠ Кт ${credit.toDecimalString()}`,
    });
  }
  return ok(
    Object.freeze({
      ...input,
      period: TaxPeriod.containing('MONTH', input.date),
      lines: Object.freeze([...input.lines]),
    }),
  );
}

/**
 * Builds a reversing (correcting) entry: same lines with swapped sides,
 * posted on `date` and referencing the original entry. The original is
 * never mutated — this is the only allowed form of historical correction.
 */
export function buildReversingEntry(
  original: LedgerEntry,
  args: { readonly id: string; readonly date: LocalDate; readonly reason: string },
): Result<LedgerEntry, LedgerEntryError> {
  return createLedgerEntry({
    id: args.id,
    companyId: original.companyId,
    sourceEventId: original.sourceEventId,
    date: args.date,
    lines: original.lines.map((l) => ({
      account: l.account,
      side: l.side === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
      amount: l.amount,
    })),
    memo: `Сторно проводки ${original.id}: ${args.reason}`,
    analytics: original.analytics,
    norm: original.norm,
    legalParamsVersion: original.legalParamsVersion,
    reversesEntryId: original.id,
  });
}
