import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

/**
 * Два способа получить БД:
 * - PGlite (встроенный Postgres, WASM) — тесты и dev без креденшалов (§11);
 * - node-postgres — боевой Postgres 16 по DATABASE_URL.
 * Схема и миграции общие; миграции checked-in в ./drizzle.
 */

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

function migrationsFolder(): string {
  // В бандлере (Next) import.meta.url указывает внутрь сборки —
  // путь переопределяется переменной окружения.
  const override = process.env['SANA_MIGRATIONS_DIR'];
  if (override !== undefined && override !== '') return override;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
}

/** Встроенный Postgres в памяти с применёнными миграциями. */
export async function createInMemoryDb(): Promise<Db> {
  const pglite = new PGlite();
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, { migrationsFolder: migrationsFolder() });
  return db;
}

/** Боевое подключение к Postgres 16. */
export async function createPostgresDb(databaseUrl: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzleNodePg(pool, { schema });
  await migrateNodePg(db, { migrationsFolder: migrationsFolder() });
  return db;
}

export { schema };
