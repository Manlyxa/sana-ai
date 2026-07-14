import type { Bin } from '../kernel/bin-iin';
import type { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import type { Rate } from '../kernel/rate';
import { err, ok, type Result } from '../kernel/result';
import { invalid, type ValidationError } from './validation';

/**
 * ЭСФ — электронный счёт-фактура (ИС ЭСФ, жизненный цикл 2026).
 *
 * Суммы хранятся как в документе-источнике: наша задача — сверять и
 * находить расхождения (правила, фаза 4), а не «исправлять» чужие данные.
 */

export type InvoiceDirection = 'OUT' | 'IN';

export type InvoiceStatus =
  | 'ЧЕРНОВИК'
  | 'ВЫСТАВЛЕН'
  | 'ПОДТВЕРЖДЁН'
  | 'ОТКЛОНЁН'
  | 'ОТОЗВАН'
  | 'АННУЛИРОВАН';

/** Допустимые переходы статусов ИС ЭСФ. */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  ЧЕРНОВИК: ['ВЫСТАВЛЕН'],
  ВЫСТАВЛЕН: ['ПОДТВЕРЖДЁН', 'ОТКЛОНЁН', 'ОТОЗВАН', 'АННУЛИРОВАН'],
  ПОДТВЕРЖДЁН: ['АННУЛИРОВАН'], // взаимное аннулирование после подтверждения
  ОТКЛОНЁН: ['ОТОЗВАН'],
  ОТОЗВАН: [],
  АННУЛИРОВАН: [],
};

export type InvoiceLine = {
  readonly description: string;
  /** Количество — только для отображения; в расчётах не участвует. */
  readonly quantity?: string;
  /** Сумма строки без НДС. */
  readonly total: Money;
  readonly vatRate: Rate;
  readonly vatAmount: Money;
};

export type Invoice = {
  /** Внутренний идентификатор Sana. */
  readonly id: string;
  /** Регистрационный номер в ИС ЭСФ. */
  readonly number: string;
  readonly direction: InvoiceDirection;
  /** Дата совершения оборота. */
  readonly turnoverDate: LocalDate;
  /** Дата выписки; null у черновика. */
  readonly issueDate: LocalDate | null;
  readonly counterpartyBin: Bin;
  readonly counterpartyName: string;
  readonly lines: readonly InvoiceLine[];
  /** Итог без НДС (должен равняться сумме строк). */
  readonly totalExVat: Money;
  /** Итог НДС (должен равняться сумме НДС строк). */
  readonly vatAmount: Money;
  readonly status: InvoiceStatus;
  readonly confirmedByRecipientAt: LocalDate | null;
  /** Дата отправки извещения о зачёте НДС (только входящие). */
  readonly vatCreditNoticeSentAt: LocalDate | null;
};

export function createInvoice(input: Invoice): Result<Invoice, ValidationError[]> {
  const errors: ValidationError[] = [];
  if (input.id.trim() === '') errors.push(invalid('id', 'внутренний id обязателен'));
  if (input.number.trim() === '') errors.push(invalid('number', 'номер ЭСФ обязателен'));
  if (input.lines.length === 0) errors.push(invalid('lines', 'нужна хотя бы одна строка'));
  if (input.status !== 'ЧЕРНОВИК' && input.issueDate === null) {
    errors.push(invalid('issueDate', 'у выставленного ЭСФ должна быть дата выписки'));
  }

  const currency = input.totalExVat.currency;
  let sumTotal = Money.zero(currency);
  let sumVat = Money.zero(currency);
  for (const line of input.lines) {
    if (line.total.currency !== currency || line.vatAmount.currency !== currency) {
      errors.push(invalid('lines', 'валюта строк не совпадает с валютой итога'));
      break;
    }
    sumTotal = sumTotal.add(line.total);
    sumVat = sumVat.add(line.vatAmount);
  }
  if (errors.length === 0) {
    if (!sumTotal.equals(input.totalExVat)) {
      errors.push(
        invalid(
          'totalExVat',
          `итог без НДС ${input.totalExVat.toDecimalString()} ≠ сумме строк ${sumTotal.toDecimalString()}`,
        ),
      );
    }
    if (!sumVat.equals(input.vatAmount)) {
      errors.push(
        invalid(
          'vatAmount',
          `итог НДС ${input.vatAmount.toDecimalString()} ≠ сумме НДС строк ${sumVat.toDecimalString()}`,
        ),
      );
    }
  }
  if (input.vatCreditNoticeSentAt !== null && input.direction !== 'IN') {
    errors.push(invalid('vatCreditNoticeSentAt', 'извещение о зачёте применимо только к входящим ЭСФ'));
  }
  if (errors.length > 0) return err(errors);
  return ok({ ...input, lines: [...input.lines] });
}

export type TransitionError = {
  readonly from: InvoiceStatus;
  readonly to: InvoiceStatus;
  readonly message: string;
};

/** Переход статуса по жизненному циклу ИС ЭСФ. */
export function transitionInvoice(
  invoice: Invoice,
  to: InvoiceStatus,
  at: LocalDate,
): Result<Invoice, TransitionError> {
  const allowed = INVOICE_TRANSITIONS[invoice.status];
  if (!allowed.includes(to)) {
    return err({
      from: invoice.status,
      to,
      message: `переход ${invoice.status} → ${to} не допускается ИС ЭСФ`,
    });
  }
  const next: Invoice = {
    ...invoice,
    status: to,
    issueDate: to === 'ВЫСТАВЛЕН' ? at : invoice.issueDate,
    confirmedByRecipientAt: to === 'ПОДТВЕРЖДЁН' ? at : invoice.confirmedByRecipientAt,
  };
  return ok(next);
}

/** Отметить отправку извещения о зачёте НДС (входящие ЭСФ). */
export function markVatCreditNoticeSent(
  invoice: Invoice,
  at: LocalDate,
): Result<Invoice, ValidationError> {
  if (invoice.direction !== 'IN') {
    return err(invalid('direction', 'извещение о зачёте отправляется только по входящим ЭСФ'));
  }
  if (invoice.vatCreditNoticeSentAt !== null) {
    return err(invalid('vatCreditNoticeSentAt', 'извещение уже отправлено'));
  }
  return ok({ ...invoice, vatCreditNoticeSentAt: at });
}

/** Итог с НДС. */
export function grossTotal(invoice: Invoice): Money {
  return invoice.totalExVat.add(invoice.vatAmount);
}
