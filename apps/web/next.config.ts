import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Миграции читаются с диска во время работы сервера; в бандле
// import.meta.url теряет смысл, поэтому путь задаём явно.
process.env['SANA_MIGRATIONS_DIR'] = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/db/drizzle',
);

const nextConfig: NextConfig = {
  // Workspace-пакеты поставляются как исходный TS — транспилируем.
  transpilePackages: [
    '@sana/api',
    '@sana/app',
    '@sana/adapters',
    '@sana/db',
    '@sana/domain',
    '@sana/legal-params',
    '@sana/ports',
  ],
  // WASM Postgres, драйвер pg и ORM не должны попадать в бандл.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'drizzle-orm'],
};

export default nextConfig;
