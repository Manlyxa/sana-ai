import {
  err,
  isKnownAccount,
  ok,
  type AccountSuggestion,
  type BusinessEvent,
  type Result,
} from '@sana/domain';
import type { LlmPort, LlmSchema } from '@sana/ports';

/**
 * AI account classifier (Module 2/3): asks the LLM to suggest accounts,
 * a category and a confidence score for an ambiguous bank transaction.
 *
 * The LLM never sees or produces monetary amounts for calculation — the
 * engine takes the amount from the event itself. A malformed or unknown
 * account in the reply degrades to «no suggestion» (null), never to an
 * error that blocks processing.
 */

const suggestionSchema: LlmSchema<AccountSuggestion> = {
  name: 'account_suggestion',
  description: 'Предложение счетов бухгалтерского учёта для банковской операции',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['debitAccount', 'creditAccount', 'category', 'confidence', 'explanation'],
    properties: {
      debitAccount: { type: 'string', description: 'Счёт по Дт (код рабочего плана счетов)' },
      creditAccount: { type: 'string', description: 'Счёт по Кт (код рабочего плана счетов)' },
      category: { type: ['string', 'null'], description: 'Статья доходов/расходов' },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      explanation: { type: 'string', description: 'Краткое объяснение на русском' },
    },
  },
  parse: (raw: unknown): Result<AccountSuggestion, string> => {
    if (typeof raw !== 'object' || raw === null) return err('ответ не является объектом');
    const r = raw as Record<string, unknown>;
    if (typeof r.debitAccount !== 'string' || typeof r.creditAccount !== 'string') {
      return err('debitAccount/creditAccount должны быть строками');
    }
    if (!isKnownAccount(r.debitAccount) || !isKnownAccount(r.creditAccount)) {
      return err(`счёт вне рабочего плана счетов: ${r.debitAccount}/${r.creditAccount}`);
    }
    if (typeof r.confidence !== 'number' || !Number.isInteger(r.confidence) || r.confidence < 0 || r.confidence > 100) {
      return err('confidence должен быть целым числом 0–100');
    }
    if (typeof r.explanation !== 'string' || r.explanation.trim() === '') {
      return err('explanation обязателен');
    }
    const category = typeof r.category === 'string' && r.category.trim() !== '' ? r.category : null;
    return ok({
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
      category,
      confidence: r.confidence,
      explanation: r.explanation,
    });
  },
};

export async function classifyWithAi(
  llm: LlmPort,
  event: BusinessEvent<'BANK_TRANSACTION'>,
): Promise<AccountSuggestion | null> {
  const p = event.payload;
  const prompt = [
    'Ты — помощник бухгалтера ТОО/ИП на СНР в Казахстане.',
    'Предложи счета рабочего плана счетов для банковской операции.',
    'Ты только классифицируешь: суммы рассчитывает система, не ты.',
    '',
    `Направление: ${p.direction === 'CREDIT' ? 'поступление' : 'списание'}`,
    `Назначение платежа: ${p.purposeText}`,
    `КНП: ${p.knp ?? 'нет'}`,
    `Контрагент: ${p.counterpartyName ?? 'неизвестен'}`,
  ].join('\n');
  const result = await llm.complete(prompt, suggestionSchema);
  return result.ok ? result.value : null;
}
