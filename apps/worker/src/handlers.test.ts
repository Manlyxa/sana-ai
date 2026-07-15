import { beforeAll, describe, expect, it } from 'vitest';
import { unwrap } from '@sana/domain';
import { createDemoDeps, type WorkerDeps } from './deps';
import { handleComplianceHeartbeat, handleRiskDigest } from './handlers';

/** Обработчики worker'а — без Redis: PGlite + fixtures. */

let deps: WorkerDeps;

beforeAll(async () => {
  deps = await createDemoDeps();
});

describe('handleComplianceHeartbeat', () => {
  it('первый прогон: ингест и находки; повторный — идемпотентен', async () => {
    const first = unwrap(await handleComplianceHeartbeat(deps));
    expect(first.eventsIngested).toBe(13);
    expect(first.findings.added).toBeGreaterThanOrEqual(9);
    expect(BigInt(first.openExposureTiyn) > 400_000_000n).toBe(true); // > 4 млн ₸ в тиынах

    const second = unwrap(await handleComplianceHeartbeat(deps));
    expect(second.eventsIngested).toBe(0);
    expect(second.findings.added).toBe(0);
    expect(second.findings.retained).toBe(first.findings.added);
  });
});

describe('handleRiskDigest', () => {
  it('утренний свод: открытые риски, критические, сумма под риском', async () => {
    const digest = unwrap(await handleRiskDigest(deps));
    expect(digest.openFindings).toBeGreaterThanOrEqual(9);
    expect(digest.criticalFindings).toBeGreaterThanOrEqual(3);
    expect(BigInt(digest.totalExposureTiyn) > 400_000_000n).toBe(true);
    expect(digest.dueSoon.length).toBeGreaterThanOrEqual(1);
    for (const item of digest.dueSoon) {
      expect(item.message.length).toBeGreaterThan(10);
    }
  });
});
