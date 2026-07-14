# Sana Guard — Architecture

AI compliance and accounting-automation platform for Kazakhstani SMBs.
This document explains the non-negotiable principles (P1–P8), how the code
enforces them, and where the seams for real integrations are.

## Monorepo layout

```
packages/
  domain/         # PURE domain logic. Zero I/O, zero framework imports.
    kernel/       # Money, Rate, LocalDate, BIN/ИИН, TaxPeriod, Justification, Result
    entities/     # (phase 2) Company, Counterparty, Employee, Invoice(ЭСФ)…
    ledger/       # (phase 2) BusinessEvent, JournalEntry, TaxRegisterEntry
    tax/          # (phase 3+) НДС, КПН, ИПН engines
    payroll/      # (phase 3) payroll engine
    rules/        # (phase 4) compliance rule engine + rule definitions
    autonomy/     # (phase 4+) autonomy levels + enforcement guard
  legal-params/   # temporal configuration of KZ law (data + resolver)
  ports/          # (phase 5) interfaces ONLY
  adapters/       # (phase 5) fixture adapters first, real adapters later
  agents/         # (phase 9) LLM agents
  app/            # (phase 6+) use-cases / orchestration
  db/             # (phase 6) Drizzle schema + migrations
  api/            # (phase 6) Fastify + tRPC
apps/
  web/            # (phase 8) Next.js client
  worker/         # (phase 7) BullMQ workers
fixtures/         # (phase 5) canned KZ data
```

Dependency direction is enforced by package boundaries:
**adapters → ports → domain**, never the reverse. `@sana/domain` has zero
runtime dependencies; `@sana/legal-params` depends only on the domain kernel.

## Principles and where they live

### P1 — Deterministic rules, probabilistic language

Every computation of a tax amount, threshold, or deadline is a pure,
unit-tested function in `packages/domain`. LLMs (phase 9, behind `LlmPort`)
only interpret free text, draft prose, and classify with confidence scores;
they are never in the path of computing a tax amount.

Enforced by: `@sana/domain` having no LLM dependency at all, and `LlmPort`
living in `packages/ports` where domain code cannot import implementations.

### P2 — Legislation is versioned data, not code

`@sana/legal-params` is a temporal store: every parameter (МРП, МЗП, ставки
НДС/КПН/ИПН/ОПВ/…, sroki ФНО) carries `validFrom`/`validTo`, a legal norm,
and a source. `resolve(key, asOf)` returns the parameter *as of a date* —
recalculating 2025 uses 2025 law. The store rejects overlapping validity
intervals at construction. Typed keys (`P.VAT_RATE_STANDARD: ParamKey<Rate>`)
make a typo'd key a compile error.

Proof test: `vat.rate.standard` resolves to 12% on 2025-06-01 and 16% on
2026-06-01 (`packages/legal-params/src/seed.test.ts`).

Hard-coding a rate in business logic is a bug; domain engines receive
resolved parameters (or the resolver) as explicit inputs.

### P3 — Every automated action carries a legal justification

`Justification` is a first-class kernel object:
`{ norm, sourceDocuments: DocRef[], parameterVersion, explanation }`.
`parameterVersion` links to a concrete `LegalParameter.version`
(e.g. `vat.rate.standard@2026-01-01`), so an audit can reproduce exactly
which version of the law a computation used.

### P4 — The company never gives us their ЭЦП

`SignaturePort` (phase 5) only *requests* signatures; no API on any port
accepts a private key. Signing is modeled as an asynchronous, human-gated
step from the start.

### P5 — Connectors are pluggable and fixture-backed

Every external system (ИС ЭСФ, кабинет налогоплательщика, banks, ОФД,
ЕСУТД, registries) sits behind a narrow interface in `packages/ports`.
Each port ships a fixture adapter with canned data in `/fixtures`; the
whole MVP runs end-to-end with zero external credentials. Real adapters
(API or RPA — availability unverified, see the TODO_VERIFY report) land in
`packages/adapters` without touching domain code.

### P6 — Autonomy levels are explicit and enforced

Every action type is tagged A0–A3 in config and checked by a single guard
in the execution pipeline (phase 4+, `packages/domain/autonomy`). It must
be impossible to execute an A1 action (ФНО, payment orders) without a
signature artifact.

### P7 — Dual ledger from day one

`JournalEntry` (НСФО bookkeeping) and `TaxRegisterEntry` (НК РК tax
treatment) are parallel, linked projections of the same immutable
`BusinessEvent` (phase 2). They diverge legitimately (e.g. book
depreciation vs. стоимостные балансы групп) and are independently
derivable.

### P8 — Shadow ledger

Every ingested fact (1С, banks, ЭСФ, ОФД) is normalized into our canonical
append-only event store. External systems are data sources, never
dependencies of the domain model.

## Kernel conventions

- **Money** — integer тиын in `bigint`; no floating point anywhere.
  Default rounding is HALF_UP (арифметическое, от нуля); tax amounts round
  to whole tenge via `roundToMajor()`. `Rate` is an exact rational
  (3.5% = 7/200), so applying a rate never touches floats.
- **Dates** — business dates are Asia/Almaty calendar dates. The kernel
  `LocalDate` is pure integer math (no `Date`); UTC→Almaty conversion
  happens at system boundaries. Working-day arithmetic takes the holiday
  calendar as data.
- **Errors** — domain logic returns `Result<T, E>`; exceptions are reserved
  for invariant violations (programmer errors), e.g. currency mismatch.
- **Validation** — `Bin`/`Iin` verify the mod-11 checksum and structure;
  parsing at boundaries returns `Result`, never throws.

## Facts pending expert verification

Parameters encoded from conflicting or unverified sources carry
`todoVerify: true` and must not be relied on in production computations.
`renderTodoVerifyReport(store)` produces the review list (§10 of the spec):
dividends ИПН, depreciation norms, СНР supplier deduction ban, единый
платёж, ЕСУТД deadline, cash settlement limit, loss carry-forward, audit
thresholds — plus the open question of whether ИС ЭСФ/ИСНА/ЕСУТД expose
third-party APIs (determines API vs. RPA adapters).

## Build order status

- [x] Phase 1 — kernel + legal params (Money, BIN/ИИН, TaxPeriod, temporal resolver; VAT 12%→16% proof)
- [x] Phase 2 — domain entities + shadow ledger (Company/Counterparty/Employee/Invoice/TaxObligation; BusinessEvent store; dual JournalEntry/TaxRegisterEntry projections)
- [x] Phase 3 — payroll engine (§6 test cases written first; cumulative progressive ИПН; property test Σ monthly = annual)
- [x] Phase 4 — rule engine + all 18 MVP rules (§7), each with firing and non-firing tests; findings carry tenge exposure, Justification, and autonomy-tagged remediation
- [x] Phase 5 — ports + fixture adapters + fixture data (end-to-end on fixtures: ingest → shadow ledger → 9 rules fire with tenge exposure; zero external credentials)
- [x] Phase 6 — persistence (Drizzle + Postgres 16, checked-in migrations, PGlite for dev/tests) and tRPC API (risk feed, runCheck ingestion, remediation behind the P6 autonomy guard)
- [ ] Phase 7 — worker (BullMQ)
- [ ] Phase 8 — web app (risk feed in tenge at risk)
- [ ] Phase 9 — LLM agents
