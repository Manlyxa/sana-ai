import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { err, ok, unwrap } from '@sana/domain';
import type { LlmSchema } from '@sana/ports';
import { AnthropicLlmAdapter, type AnthropicLikeClient } from './anthropic-llm-adapter';

/** Стаб клиента: ни сети, ни ключа — проверяем контракт адаптера. */
function stubClient(
  response: { stop_reason: string | null; content: { type: string; text?: string }[] },
  onParams?: (params: unknown) => void,
): AnthropicLikeClient {
  return {
    messages: {
      create: async (params) => {
        onParams?.(params);
        return response;
      },
    },
  };
}

const schema: LlmSchema<{ answer: string }> = {
  name: 'test-schema',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer'],
    properties: { answer: { type: 'string' } },
  },
  parse: (raw) => {
    const parsed = z.object({ answer: z.string() }).safeParse(raw);
    return parsed.success ? ok(parsed.data) : err(parsed.error.message);
  },
};

describe('AnthropicLlmAdapter', () => {
  it('передаёт structured outputs и парсит ответ через строгую схему', async () => {
    let seen: unknown;
    const adapter = new AnthropicLlmAdapter(
      stubClient(
        { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"да"}' }] },
        (p) => {
          seen = p;
        },
      ),
    );
    const result = unwrap(await adapter.complete('вопрос', schema));
    expect(result.answer).toBe('да');
    expect(seen).toMatchObject({
      model: 'claude-opus-4-8',
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: schema.jsonSchema } },
    });
  });

  it('refusal → типизированная ошибка REMOTE, контент не читается', async () => {
    const adapter = new AnthropicLlmAdapter(stubClient({ stop_reason: 'refusal', content: [] }));
    const r = await adapter.complete('вопрос', schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('REMOTE');
  });

  it('обрыв по max_tokens → REMOTE (JSON наверняка неполон)', async () => {
    const adapter = new AnthropicLlmAdapter(
      stubClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"ans' }] }),
    );
    const r = await adapter.complete('вопрос', schema);
    expect(r.ok).toBe(false);
  });

  it('невалидный JSON и несоответствие схеме → PARSE', async () => {
    const badJson = new AnthropicLlmAdapter(
      stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'не json' }] }),
    );
    const r1 = await badJson.complete('вопрос', schema);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.kind).toBe('PARSE');

    const wrongShape = new AnthropicLlmAdapter(
      stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"other":1}' }] }),
    );
    const r2 = await wrongShape.complete('вопрос', schema);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe('PARSE');
  });

  it('сетевая ошибка → REMOTE', async () => {
    const failing: AnthropicLikeClient = {
      messages: {
        create: async () => {
          throw new Error('connection reset');
        },
      },
    };
    const r = await new AnthropicLlmAdapter(failing).complete('вопрос', schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('REMOTE');
  });
});
