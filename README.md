# Sana Guard

AI compliance guardian for Kazakhstani SMBs: never miss a deadline, never
lose a VAT credit, never transact with a fraudulent counterparty.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for principles and layout.

## Development

```sh
pnpm install
pnpm typecheck   # tsc across all packages
pnpm test        # vitest; ≥90% coverage enforced in domain
pnpm dev         # boots API (:3000) + web (:3000/next) on fixtures + embedded
                 # Postgres (PGlite) — zero external credentials
```

Optional services: `DATABASE_URL` switches persistence to PostgreSQL 16;
`REDIS_URL` enables the BullMQ schedule in `apps/worker` (hourly compliance
heartbeat, morning risk digest — Asia/Almaty).

Requires Node ≥ 22 and pnpm 10.
