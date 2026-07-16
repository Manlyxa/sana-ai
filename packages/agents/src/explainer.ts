import { z } from 'zod';
import { err, ok, type Finding } from '@sana/domain';
import type { LlmPort, LlmSchema } from '@sana/ports';

/**
 * Explainer: превращает Justification находки в одно предложение,
 * понятное владельцу бизнеса. LLM недоступна/ошиблась — детерминированный
 * фолбэк (message находки уже написан по-русски): объяснение никогда
 * не блокирует ленту рисков.
 */

export type Explanation = {
  readonly sentence: string;
  readonly source: 'llm' | 'fallback';
};

const explanationZod = z.object({ sentence: z.string().min(10).max(400) });

export const explanationSchema: LlmSchema<{ sentence: string }> = {
  name: 'finding-explanation',
  description: 'Одно предложение для владельца бизнеса',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sentence'],
    properties: { sentence: { type: 'string' } },
  },
  parse: (raw) => {
    const parsed = explanationZod.safeParse(raw);
    return parsed.success ? ok(parsed.data) : err(parsed.error.message);
  },
};

function buildPrompt(finding: Finding): string {
  const docs = finding.justification.sourceDocuments
    .map((d) => `${d.documentType} ${d.documentId}`)
    .join('; ');
  return `Объясни владельцу ТОО одним предложением (по-русски, без канцелярита,
без цифр статей закона в начале), что случилось и что будет, если ничего не сделать.
Сумма под риском: ${finding.exposure.toDecimalString()} ₸.
Норма: ${finding.justification.norm}. Документы: ${docs}.
Служебное описание: ${finding.justification.explanation}`;
}

export async function explainFinding(llm: LlmPort, finding: Finding): Promise<Explanation> {
  const completed = await llm.complete(buildPrompt(finding), explanationSchema);
  if (completed.ok) {
    return { sentence: completed.value.sentence, source: 'llm' };
  }
  // Фолбэк: находка уже несёт объяснение простым языком (P3).
  return { sentence: finding.message, source: 'fallback' };
}
