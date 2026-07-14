import { err, ok, type Result } from '@sana/domain';
import type { LlmPort, LlmSchema, PortError } from '@sana/ports';

/**
 * Mock-адаптер LLM: детерминированные консервированные ответы по имени
 * схемы. Реальный адаптер (Anthropic SDK) появится в фазе 9 — и тоже
 * останется за LlmPort (P1: LLM никогда не считает налоги).
 */
export class MockLlmAdapter implements LlmPort {
  constructor(private readonly canned: Record<string, unknown> = {}) {}

  async complete<T>(_prompt: string, schema: LlmSchema<T>): Promise<Result<T, PortError>> {
    if (!(schema.name in this.canned)) {
      return err({ kind: 'REMOTE', message: `нет канонического ответа для схемы «${schema.name}»` });
    }
    const parsed = schema.parse(this.canned[schema.name]);
    if (!parsed.ok) {
      return err({ kind: 'PARSE', message: `ответ не соответствует схеме: ${parsed.error}` });
    }
    return ok(parsed.value);
  }
}
