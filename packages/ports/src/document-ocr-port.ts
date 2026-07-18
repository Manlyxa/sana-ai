import type { LocalDate, Money, Result } from '@sana/domain';
import type { PortError } from './common';

/**
 * Распознавание первичных документов (§8). На этом этапе — фикстура:
 * реальный OCR заменит адаптер, не контракт. Классификатор предлагает
 * только счета и уверенность — суммы дальше по конвейеру проверяет код.
 */

export type RecognizedDocument = {
  /** Человеческое название («Авансовый отчёт — такси»). */
  readonly title: string;
  /** Тип первички («авансовый отчёт», «чек ОФД», «акт»). */
  readonly documentType: string;
  readonly date: LocalDate;
  readonly amount: Money;
  readonly counterpartyName: string | null;
  /** Назначение операции, как его прочитал OCR. */
  readonly purpose: string;
  /** Уверенность распознавания 0–100. */
  readonly confidence: number;
  /** Предложение классификатора: только счета и категория. */
  readonly debitAccount: string;
  readonly creditAccount: string;
  readonly category: string | null;
};

export interface DocumentOcrPort {
  recognize(fileName: string): Promise<Result<RecognizedDocument, PortError>>;
}
