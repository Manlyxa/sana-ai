import Anthropic from '@anthropic-ai/sdk';
import { err, ok, type Result } from '@sana/domain';
import type { LlmPort, LlmSchema, PortError } from '@sana/ports';

/**
 * Боевой LLM-адаптер: Anthropic SDK за LlmPort (P1). Structured outputs
 * гарантируют форму ответа; строгая схема агента валидирует содержимое.
 * LLM никогда не находится в пути вычисления суммы налога — этот адаптер
 * используют только агенты (интерпретация текста, черновики, советы).
 */

/** Минимальный интерфейс клиента — для инъекции стаба в тестах. */
export type AnthropicLikeClient = {
  messages: {
    create: (params: {
      model: string;
      max_tokens: number;
      thinking: { type: 'adaptive' };
      output_config: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
      messages: { role: 'user'; content: string }[];
    }) => Promise<{
      stop_reason: string | null;
      content: { type: string; text?: string }[];
    }>;
  };
};

export class AnthropicLlmAdapter implements LlmPort {
  constructor(
    private readonly client: AnthropicLikeClient = new Anthropic(),
    private readonly model = 'claude-opus-4-8',
    private readonly maxTokens = 16_000,
  ) {}

  async complete<T>(prompt: string, schema: LlmSchema<T>): Promise<Result<T, PortError>> {
    let response: Awaited<ReturnType<AnthropicLikeClient['messages']['create']>>;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: schema.jsonSchema } },
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (e) {
      return err({ kind: 'REMOTE', message: `Anthropic API: ${e instanceof Error ? e.message : String(e)}` });
    }

    if (response.stop_reason === 'refusal') {
      return err({ kind: 'REMOTE', message: 'модель отклонила запрос (stop_reason: refusal)' });
    }
    if (response.stop_reason === 'max_tokens') {
      return err({ kind: 'REMOTE', message: 'ответ обрезан по max_tokens — вероятно невалидный JSON' });
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (text === undefined) {
      return err({ kind: 'PARSE', message: 'в ответе нет текстового блока' });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return err({ kind: 'PARSE', message: 'ответ модели — не валидный JSON' });
    }
    const parsed = schema.parse(raw);
    if (!parsed.ok) {
      return err({ kind: 'PARSE', message: `ответ не соответствует схеме «${schema.name}»: ${parsed.error}` });
    }
    return ok(parsed.value);
  }
}
