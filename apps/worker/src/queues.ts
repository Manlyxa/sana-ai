import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createDemoDeps, type WorkerDeps } from './deps';
import { handleComplianceHeartbeat, handleRiskDigest } from './handlers';

/**
 * BullMQ-обвязка. Расписание — сердцебиение продукта (§7):
 * - компл.-проверка каждый час и по событию ингеста;
 * - утренний свод рисков в 07:00 Алматы.
 * Требует Redis (REDIS_URL); обработчики тестируются без него.
 */

export const QUEUE_NAME = 'sana-guard';

export const JOBS = {
  COMPLIANCE_HEARTBEAT: 'compliance-heartbeat',
  RISK_DIGEST: 'risk-digest',
} as const;

export function connectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port === '' ? 6379 : url.port),
    ...(url.password === '' ? {} : { password: url.password }),
  };
}

export async function scheduleRepeatableJobs(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(JOBS.COMPLIANCE_HEARTBEAT, {
    pattern: '0 * * * *', // ежечасно
    tz: 'Asia/Almaty',
  });
  await queue.upsertJobScheduler(JOBS.RISK_DIGEST, {
    pattern: '0 7 * * *', // утренний свод
    tz: 'Asia/Almaty',
  });
}

export function startWorker(connection: ConnectionOptions, deps: WorkerDeps): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case JOBS.COMPLIANCE_HEARTBEAT: {
          const r = await handleComplianceHeartbeat(deps);
          if (!r.ok) throw new Error(r.error.message);
          return r.value;
        }
        case JOBS.RISK_DIGEST: {
          const r = await handleRiskDigest(deps);
          if (!r.ok) throw new Error(r.error.message);
          return r.value;
        }
        default:
          throw new Error(`неизвестное задание: ${job.name}`);
      }
    },
    { connection },
  );
}

export async function bootstrap(redisUrl: string): Promise<{ queue: Queue; worker: Worker }> {
  const connection = connectionFromUrl(redisUrl);
  const deps = await createDemoDeps();
  const queue = new Queue(QUEUE_NAME, { connection });
  await scheduleRepeatableJobs(queue);
  const worker = startWorker(connection, deps);
  return { queue, worker };
}
