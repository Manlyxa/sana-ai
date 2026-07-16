import { z } from 'zod';
import { err, ok, type Result } from '@sana/domain';
import type { LlmPort, LlmSchema, PortError } from '@sana/ports';

/**
 * NoticeInterpreter (P1): LLM интерпретирует свободный текст уведомления
 * КГД → структурированное обязательство + черновик ответа.
 *
 * LLM здесь НЕ считает налоги — только читает текст. Низкая уверенность
 * маршрутизирует результат человеку (needsHumanReview), а сам ответ на
 * уведомление — действие A1: подаётся только с ЭЦП владельца.
 */

export type InterpretedNotice = {
  readonly noticeNumber: string | null;
  readonly subject: string;
  /** Код периода («2025-Q4»), если выводим из текста. */
  readonly periodCode: string | null;
  /** Сумма расхождения в тиынах (строка), если названа. */
  readonly discrepancyAmountTiyn: string | null;
  readonly responseDeadlineWorkingDays: number;
  readonly requiredAction: string;
  /** Черновик пояснения в КГД (русский, официальный стиль). */
  readonly draftResponse: string;
  /** 0..1 — уверенность модели в разборе. */
  readonly confidence: number;
};

export type NoticeInterpretation = {
  readonly notice: InterpretedNotice;
  /** true — на стол человеку до любых действий (низкая уверенность). */
  readonly needsHumanReview: boolean;
};

export const HUMAN_REVIEW_CONFIDENCE_THRESHOLD = 0.75;

const zodSchema = z.object({
  noticeNumber: z.string().nullable(),
  subject: z.string().min(3),
  periodCode: z.string().nullable(),
  discrepancyAmountTiyn: z.string().regex(/^\d+$/).nullable(),
  responseDeadlineWorkingDays: z.number().int().positive(),
  requiredAction: z.string().min(3),
  draftResponse: z.string().min(20),
  confidence: z.number().min(0).max(1),
});

export const noticeSchema: LlmSchema<InterpretedNotice> = {
  name: 'kgd-notice-interpretation',
  description: 'Структурированная интерпретация уведомления КГД РК',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'noticeNumber',
      'subject',
      'periodCode',
      'discrepancyAmountTiyn',
      'responseDeadlineWorkingDays',
      'requiredAction',
      'draftResponse',
      'confidence',
    ],
    properties: {
      noticeNumber: { type: ['string', 'null'] },
      subject: { type: 'string' },
      periodCode: { type: ['string', 'null'], description: 'Код периода, напр. «2025-Q4»' },
      discrepancyAmountTiyn: {
        type: ['string', 'null'],
        description: 'Сумма расхождения в тиынах, только цифры',
      },
      responseDeadlineWorkingDays: { type: 'integer' },
      requiredAction: { type: 'string' },
      draftResponse: { type: 'string' },
      confidence: { type: 'number' },
    },
  },
  parse: (raw) => {
    const parsed = zodSchema.safeParse(raw);
    return parsed.success ? ok(parsed.data) : err(parsed.error.message);
  },
};

const PROMPT_PREFIX = `Ты — налоговый ассистент для ТОО в Казахстане. Ниже — полный текст
уведомления Комитета государственных доходов. Извлеки из него структуру строго по схеме:
- noticeNumber: номер уведомления, если указан;
- subject: краткая суть (1 предложение);
- periodCode: налоговый период в формате «YYYY-QN» / «YYYY-MNN» / «YYYY», если выводится из текста;
- discrepancyAmountTiyn: сумма расхождения В ТИЫНАХ (тенге × 100), только цифры; null, если сумма не названа;
- responseDeadlineWorkingDays: срок исполнения в РАБОЧИХ днях, как указан в тексте;
- requiredAction: что требуется сделать (доп. отчётность / пояснение и т.п.);
- draftResponse: вежливый черновик пояснения в КГД от лица налогоплательщика (официальный стиль,
  русский язык, без выдуманных фактов — там, где нужны данные компании, ставь плейсхолдеры в
  квадратных скобках);
- confidence: твоя уверенность в разборе от 0 до 1.
НИЧЕГО не считай сам — только извлекай то, что написано.

ТЕКСТ УВЕДОМЛЕНИЯ:
`;

export async function interpretNotice(
  llm: LlmPort,
  noticeText: string,
): Promise<Result<NoticeInterpretation, PortError>> {
  const completed = await llm.complete(PROMPT_PREFIX + noticeText, noticeSchema);
  if (!completed.ok) return completed;
  const notice = completed.value;
  return ok({
    notice,
    needsHumanReview: notice.confidence < HUMAN_REVIEW_CONFIDENCE_THRESHOLD,
  });
}
