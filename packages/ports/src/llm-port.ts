import type { Result } from '@sana/domain';
import type { PortError } from './common';

/**
 * LLM (P1): только интерпретация свободного текста, черновики писем,
 * советы по режимам и классификация с confidence. НИКОГДА не в пути
 * вычисления суммы налога.
 */

/** Схема структурированного ответа: имя + строгий парсер (Zod-обёртка в адаптере). */
export type LlmSchema<T> = {
  readonly name: string;
  readonly description?: string;
  readonly parse: (raw: unknown) => Result<T, string>;
};

export interface LlmPort {
  complete<T>(prompt: string, schema: LlmSchema<T>): Promise<Result<T, PortError>>;
}
