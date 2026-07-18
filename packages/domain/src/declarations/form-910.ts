import { findAccount } from '../accounting/chart-of-accounts';
import type { LedgerEntry } from '../accounting/ledger-entry';
import type { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import type { Rate } from '../kernel/rate';
import { err, ok, type Result } from '../kernel/result';
import type { TaxPeriod } from '../kernel/tax-period';
import { periodOffsetDate } from '../rules/helpers';

/**
 * Форма 910.00 — упрощённая декларация (§5). Заполняется РАСЧЁТОМ из
 * проводок реестра за полугодие: доход — кредитовый оборот доходных
 * счетов (сторно уменьшает), налог — доход × ставка СНР из legal-params.
 * Каждая цифра ссылается на проводки-основания (entryIds) и версию
 * параметров.
 */

export type Form910Params = {
  /** Ставка упрощёнки (ст. 727 НК РК). */
  readonly rate: Rate;
  /** Предел дохода на СНР, МРП (ст. 722 НК РК). */
  readonly incomeLimitMrp: number;
  readonly mrp: Money;
  /** Срок сдачи: день D через N месяцев после конца периода (ст. 728 НК РК). */
  readonly filingDue: { readonly monthsAfterPeriodEnd: number; readonly dayOfMonth: number };
  readonly version: string;
};

export type Form910 = {
  readonly period: TaxPeriod;
  /** 910.00.001 — доход за период. */
  readonly income: Money;
  readonly rate: Rate;
  /** Налог к уплате = доход × ставка, в целых тенге. */
  readonly tax: Money;
  readonly filingDeadline: LocalDate;
  readonly incomeLimit: Money;
  readonly limitExceeded: boolean;
  /** Проводки-основания дохода («объясни эту цифру»). */
  readonly revenueEntryIds: readonly string[];
  readonly norm: string;
  readonly paramsVersion: string;
};

export type Form910Error = { readonly message: string };

/** Доход за период: кредитовый минус дебетовый оборот доходных счетов. */
export function revenueForPeriod(
  entries: readonly LedgerEntry[],
  period: TaxPeriod,
): { readonly income: Money; readonly entryIds: readonly string[] } {
  let income = Money.zero();
  const entryIds: string[] = [];
  for (const entry of entries) {
    if (!period.contains(entry.date)) continue;
    let touched = false;
    for (const line of entry.lines) {
      if (findAccount(line.account)?.type !== 'REVENUE') continue;
      income = line.side === 'CREDIT' ? income.add(line.amount) : income.subtract(line.amount);
      touched = true;
    }
    if (touched) entryIds.push(entry.id);
  }
  return { income, entryIds };
}

export function computeForm910(
  entries: readonly LedgerEntry[],
  period: TaxPeriod,
  params: Form910Params,
): Result<Form910, Form910Error> {
  if (period.kind !== 'HALF_YEAR') {
    return err({ message: `910.00 сдаётся за полугодие, получен период ${period.code()}` });
  }
  const { income, entryIds } = revenueForPeriod(entries, period);
  if (income.isNegative()) {
    return err({ message: `доход за период отрицательный (${income.toDecimalString()}) — проверьте сторно` });
  }
  const incomeLimit = params.mrp.multiply(params.incomeLimitMrp);
  return ok({
    period,
    income,
    rate: params.rate,
    tax: income.percent(params.rate).roundToMajor(),
    filingDeadline: periodOffsetDate(period.end(), params.filingDue),
    incomeLimit,
    limitExceeded: income.compareTo(incomeLimit) > 0,
    revenueEntryIds: entryIds,
    norm: 'ст. 722, 727–728 НК РК (СНР на основе упрощённой декларации)',
    paramsVersion: params.version,
  });
}
