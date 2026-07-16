import type { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import { err, ok, type Result } from '../kernel/result';
import type { AccountCode } from './accounts';

/**
 * JournalEntry — бухгалтерская проводка (НСФО), проекция BusinessEvent (P7).
 * Инвариант двойной записи: Σ дебет = Σ кредит, одна валюта, суммы > 0.
 */

export type EntrySide = 'DEBIT' | 'CREDIT';

export type JournalLine = {
  readonly account: AccountCode;
  readonly side: EntrySide;
  readonly amount: Money;
};

export type JournalEntry = {
  readonly id: string;
  readonly companyId: string;
  /** Событие, проекцией которого является проводка. */
  readonly businessEventId: string;
  readonly date: LocalDate;
  readonly lines: readonly JournalLine[];
  readonly memo: string;
};

export type JournalEntryError = { readonly message: string };

export function createJournalEntry(input: JournalEntry): Result<JournalEntry, JournalEntryError> {
  if (input.lines.length < 2) {
    return err({ message: 'проводка должна иметь минимум две строки' });
  }
  const currency = (input.lines[0] as JournalLine).amount.currency;
  let debit = Money.zero(currency);
  let credit = Money.zero(currency);
  for (const line of input.lines) {
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
      message: `дебет ${debit.toDecimalString()} ≠ кредит ${credit.toDecimalString()}`,
    });
  }
  return ok({ ...input, lines: [...input.lines] });
}

/** Суммарный оборот проводки (Σ дебет = Σ кредит). */
export function entryTotal(entry: JournalEntry): Money {
  const currency = (entry.lines[0] as JournalLine).amount.currency;
  return entry.lines
    .filter((l) => l.side === 'DEBIT')
    .reduce((acc, l) => acc.add(l.amount), Money.zero(currency));
}
