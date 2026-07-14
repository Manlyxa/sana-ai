# Sana Guard

AI compliance guardian for Kazakhstani SMBs: never miss a deadline, never
lose a VAT credit, never transact with a fraudulent counterparty.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for principles and layout.

## Development

```sh
pnpm install
pnpm typecheck   # tsc across all packages
pnpm test        # vitest with ≥90% coverage enforced in domain packages
```

Requires Node ≥ 22 and pnpm 10.
