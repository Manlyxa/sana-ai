import type { Bin, Invoice, InvoiceDirection, Result } from '@sana/domain';
import type { DateRange, PortError } from './common';

/** ИС ЭСФ: чтение и выпуск электронных счетов-фактур. */
export interface EsfPort {
  listInvoices(
    companyBin: Bin,
    range: DateRange,
    direction?: InvoiceDirection,
  ): Promise<Result<readonly Invoice[], PortError>>;

  /** Выставить ЭСФ (действие A2 — по подтверждению в приложении). */
  issueInvoice(draft: Invoice): Promise<Result<Invoice, PortError>>;

  /** Подтвердить входящий ЭСФ. */
  confirmInvoice(invoiceId: string): Promise<Result<Invoice, PortError>>;

  /** Отклонить входящий ЭСФ. */
  rejectInvoice(invoiceId: string, reason: string): Promise<Result<Invoice, PortError>>;

  /** Отправить извещение о зачёте НДС (действие A3). */
  sendVatCreditNotice(invoiceId: string): Promise<Result<Invoice, PortError>>;
}
