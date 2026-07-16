import { err, ok, type Result } from './result';

/**
 * Justification — правовое обоснование автоматического действия (P3).
 * Первоклассный объект: показывается пользователю, защищает при проверке.
 */

/** Ссылка на документ-основание в исходной системе. */
export type DocRef = {
  /** Система-источник: ИС ЭСФ, банк, ОФД, КГД и т.п. */
  readonly system: string;
  /** Тип документа: ЭСФ, выписка, уведомление, приказ… */
  readonly documentType: string;
  /** Идентификатор документа в системе-источнике. */
  readonly documentId: string;
  readonly description?: string;
};

export type Justification = {
  /** Норма права: «п. 8 ст. 480 НК РК». */
  readonly norm: string;
  readonly sourceDocuments: readonly DocRef[];
  /** Версия параметра из @sana/legal-params: «vat.rate.standard@2026-01-01». */
  readonly parameterVersion: string;
  /** Объяснение простым языком — для владельца бизнеса. */
  readonly explanation: string;
};

export function createJustification(input: Justification): Result<Justification, string> {
  if (input.norm.trim() === '') return err('Justification.norm не может быть пустым');
  if (input.explanation.trim() === '') return err('Justification.explanation не может быть пустым');
  if (input.parameterVersion.trim() === '') return err('Justification.parameterVersion не может быть пустым');
  return ok({
    norm: input.norm,
    sourceDocuments: [...input.sourceDocuments],
    parameterVersion: input.parameterVersion,
    explanation: input.explanation,
  });
}
