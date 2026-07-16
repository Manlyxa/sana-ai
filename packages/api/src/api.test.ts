import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from './router';
import { createDemoContext, type ApiContext } from './context';
import { createServer } from './server';

/**
 * API-тесты: полный конвейер через tRPC поверх PGlite + fixtures.
 * Ни сети, ни креденшалов.
 */

let ctx: ApiContext;
let caller: ReturnType<typeof appRouter.createCaller>;

beforeAll(async () => {
  ctx = await createDemoContext();
  caller = appRouter.createCaller(ctx);
});

describe('tRPC API', () => {
  it('health и company', async () => {
    expect(await caller.health()).toEqual({ status: 'ok' });
    const company = await caller.company();
    expect(company.bin).toBe('120540000001');
    expect(company.taxRegime).toBe('ОУР');
  });

  it('runCheck: ингест в БД + сверка находок', async () => {
    const run = await caller.runCheck();
    expect(run.eventsIngested).toBe(13);
    expect(run.journalEntries).toBe(13);
    expect(run.taxRegisterEntries).toBeGreaterThanOrEqual(8);
    expect(run.findings.added).toBeGreaterThanOrEqual(9);
    expect(run.findings.resolved).toBe(0);

    // повторный прогон идемпотентен: события не дублируются, находки удержаны
    const rerun = await caller.runCheck();
    expect(rerun.eventsIngested).toBe(0);
    expect(rerun.findings.added).toBe(0);
    expect(rerun.findings.retained).toBe(run.findings.added);

    const ledger = await caller.ledger();
    expect(ledger.events).toBe(13);
    expect(ledger.journalEntries).toBe(13);
  });

  it('riskFeed: лента в тенге под риском, по убыванию', async () => {
    const feed = await caller.riskFeed();
    expect(feed.length).toBeGreaterThanOrEqual(9);
    const top = feed[0]!;
    expect(top.ruleId).toBe('FILING_DEADLINE_APPROACHING');
    expect(top.exposureTenge).toBe('2340000.00');
    expect(top.norm).toBeTruthy();
    expect(top.parameterVersion).toBe('legal-params@2026-05-10');
    for (let i = 1; i < feed.length; i++) {
      expect(BigInt(feed[i - 1]!.exposureTiyn) >= BigInt(feed[i]!.exposureTiyn)).toBe(true);
    }
  });

  it('remediate: A3 исполняется сразу и гасит находку при следующем прогоне', async () => {
    const findingId = 'VAT_CREDIT_NOTICE_MISSING:ESF-IN-2026-0001';
    const result = await caller.remediate({ findingId });
    expect(result).toEqual({
      executed: true,
      action: 'SEND_VAT_CREDIT_NOTICE',
      documentId: 'ESF-IN-2026-0001',
    });

    const rerun = await caller.runCheck();
    expect(rerun.findings.resolved).toBeGreaterThanOrEqual(1);
    const feed = await caller.riskFeed();
    expect(feed.some((f) => f.id === findingId)).toBe(false);
  });

  it('remediate: A2 без подтверждения запрещён, с подтверждением исполняется', async () => {
    const findingId = 'ESF_CONFIRMATION_PENDING:ESF-IN-2026-0004';
    await expect(caller.remediate({ findingId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const confirmed = await caller.remediate({
      findingId,
      confirmation: { confirmedBy: 'owner@demo.kz', atIso: '2026-05-10T15:00:00+05:00' },
    });
    expect(confirmed.executed).toBe(true);
    expect(confirmed.action).toBe('CONFIRM_ESF');
  });

  it('remediate: A1 без артефакта подписи НЕВОЗМОЖЕН (P6)', async () => {
    const feed = await caller.riskFeed();
    const a1 = feed.find((f) => f.remediation.autonomyLevel === 'A1')!;
    await expect(caller.remediate({ findingId: a1.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // с артефактом — guard пропускает, но исполнитель ещё не реализован
    await expect(
      caller.remediate({
        findingId: a1.id,
        signature: { requestId: 'sigreq-1', cmsBase64: 'TU9DSw==' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('remediate: неизвестная находка → NOT_FOUND', async () => {
    await expect(caller.remediate({ findingId: 'нет:такой' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('HTTP-сервер', () => {
  it('health + tRPC поверх Fastify', async () => {
    const server = await createServer(ctx);
    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const trpcHealth = await server.inject({ method: 'GET', url: '/trpc/health' });
    expect(trpcHealth.statusCode).toBe(200);
    expect(JSON.parse(trpcHealth.body).result.data.status).toBe('ok');
    await server.close();
  });
});
