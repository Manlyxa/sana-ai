import {
  createBusinessEvent,
  err,
  ok,
  type BusinessEvent,
  type LocalDate,
  type Result,
} from '@sana/domain';
import type { DocumentOcrPort, RecognizedDocument } from '@sana/ports';
import type { AccountingWorkspace, PendingOperation } from '../accounting/accounting-workspace';

/**
 * Документы (§8): загруженный файл → фикстурный OCR → НАСТОЯЩАЯ запись
 * в той же очереди подтверждения, что и автопроводки (§3). Не рисуем
 * очередь в UI отдельно: подтверждение документа идёт тем же use-case
 * (accounting.confirm), создаёт проводку и обучающее правило.
 * Документы всегда требуют подтверждения человеком (A2) — независимо
 * от уверенности OCR.
 */

export type DocumentIntakeError = { readonly message: string };

export type DocumentIntakeResult = {
  readonly recognized: RecognizedDocument;
  readonly pending: PendingOperation;
};

let intakeSeq = 0;

/** Событие теневого регистра из распознанного документа. */
export function eventFromDocument(
  companyId: string,
  doc: RecognizedDocument,
  args: { readonly documentId: string; readonly today: LocalDate },
): Result<BusinessEvent<'BANK_TRANSACTION'>, DocumentIntakeError> {
  const event = createBusinessEvent<'BANK_TRANSACTION'>({
    id: `doc-${args.documentId}`,
    companyId,
    occurredAt: doc.date,
    type: 'BANK_TRANSACTION',
    payload: {
      direction: 'DEBIT',
      amount: doc.amount,
      counterpartyBin: null,
      counterpartyName: doc.counterpartyName,
      purposeText: doc.purpose,
      knp: null,
    },
    sourceSystem: 'РУЧНОЙ_ВВОД',
    sourceDocumentRef: {
      system: 'SANA',
      documentType: doc.documentType,
      documentId: args.documentId,
      description: doc.title,
    },
    ingestedAt: args.today,
  });
  if (!event.ok) return err({ message: event.error.message });
  return ok(event.value);
}

/** Загрузка файла: распознать (фикстура) и поставить в очередь подтверждения. */
export async function intakeDocumentFile(
  workspace: AccountingWorkspace,
  ocr: DocumentOcrPort,
  args: { readonly fileName: string; readonly today: LocalDate },
): Promise<Result<DocumentIntakeResult, DocumentIntakeError>> {
  const recognized = await ocr.recognize(args.fileName);
  if (!recognized.ok) return err({ message: recognized.error.message });
  const doc = recognized.value;

  intakeSeq += 1;
  const event = eventFromDocument(workspace.companyId, doc, {
    documentId: `${args.fileName}-${intakeSeq}`,
    today: args.today,
  });
  if (!event.ok) return event;

  const queued = workspace.queueDocument(event.value, {
    debitAccount: doc.debitAccount,
    creditAccount: doc.creditAccount,
    category: doc.category,
    confidence: doc.confidence,
    explanation: `Распознано из документа «${doc.title}» (уверенность OCR ${doc.confidence}%).`,
  });
  if (!queued.ok) return err({ message: queued.error.message });
  return ok({ recognized: doc, pending: queued.value });
}
