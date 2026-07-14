import type { LocalDate } from '@sana/domain';

/**
 * Порты (P5): узкие интерфейсы к внешним системам РК. Здесь ТОЛЬКО
 * интерфейсы и DTO — ни одной реализации. Реализации живут в
 * @sana/adapters (fixture сейчас, API/RPA потом) и не меняют домен.
 * Направление зависимостей: adapters → ports → domain. Никогда обратно.
 */

export type PortError = {
  readonly kind: 'NOT_FOUND' | 'IO' | 'PARSE' | 'REMOTE' | 'VALIDATION' | 'UNSUPPORTED';
  readonly message: string;
};

export type DateRange = {
  readonly from: LocalDate;
  readonly to: LocalDate;
};
