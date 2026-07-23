import { createPostgresDb } from '@sana/db';
import { createDemoContext } from './context';
import { createServer } from './server';

/**
 * Точка входа dev-стека: fixtures + встроенный Postgres, ноль креденшалов.
 * DATABASE_URL переключает на боевой Postgres 16.
 *
 * Порт по умолчанию — 3001, а не 3000: apps/web вызывает этот роутер
 * в своём же процессе (packages/api/src/index.ts, без HTTP-хопа), так
 * что этот HTTP-сервер нужен только внешним клиентам и не должен
 * соперничать с Next.js dev-сервером за порт 3000 при `pnpm dev`.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const db = databaseUrl === undefined ? undefined : await createPostgresDb(databaseUrl);
  const ctx = await createDemoContext(db);
  const server = await createServer(ctx);
  const port = Number(process.env['PORT'] ?? 3001);
  await server.listen({ port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`Sana Guard API: http://localhost:${port} (${databaseUrl === undefined ? 'PGlite + fixtures' : 'Postgres'})`);
}

void main();
