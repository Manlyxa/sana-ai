import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Queue, QueueEvents } from 'bullmq';
import { connectionFromUrl, JOBS, QUEUE_NAME, scheduleRepeatableJobs, startWorker } from './queues';
import { createDemoDeps } from './deps';

/**
 * Интеграция BullMQ с живым Redis. Автоматически пропускается там,
 * где redis-server недоступен (обработчики покрыты отдельно без Redis).
 */

const REDIS_AVAILABLE = spawnSync('which', ['redis-server']).status === 0;
const PORT = 6390;
const URL_ = `redis://127.0.0.1:${PORT}`;

let redis: ChildProcess | null = null;

describe.skipIf(!REDIS_AVAILABLE)('BullMQ поверх живого Redis', () => {
  beforeAll(async () => {
    redis = spawn('redis-server', ['--port', String(PORT), '--save', '', '--appendonly', 'no'], {
      stdio: 'ignore',
    });
    // ждём готовности
    for (let i = 0; i < 50; i++) {
      const ping = spawnSync('redis-cli', ['-p', String(PORT), 'ping']);
      if (ping.stdout?.toString().trim() === 'PONG') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('redis-server не поднялся');
  }, 20_000);

  afterAll(() => {
    redis?.kill();
  });

  it('задание compliance-heartbeat проходит очередь и возвращает сводку', async () => {
    const connection = connectionFromUrl(URL_);
    const deps = await createDemoDeps();
    const queue = new Queue(QUEUE_NAME, { connection });
    const events = new QueueEvents(QUEUE_NAME, { connection });
    await events.waitUntilReady();
    const worker = startWorker(connection, deps);

    try {
      const job = await queue.add(JOBS.COMPLIANCE_HEARTBEAT, {});
      const result = (await job.waitUntilFinished(events, 25_000)) as {
        eventsIngested: number;
        findings: { added: number };
      };
      expect(result.eventsIngested).toBe(13);
      expect(result.findings.added).toBeGreaterThanOrEqual(9);

      // расписание регистрируется без ошибок
      await scheduleRepeatableJobs(queue);
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => s.name).sort()).toEqual([
        JOBS.COMPLIANCE_HEARTBEAT,
        JOBS.RISK_DIGEST,
      ]);
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 30_000);
});
