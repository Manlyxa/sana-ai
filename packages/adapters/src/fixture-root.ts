import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень каталога /fixtures монорепозитория. */
export function defaultFixturesRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
}
