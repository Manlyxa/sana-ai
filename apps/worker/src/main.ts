import { bootstrap } from './queues';

/**
 * Точка входа worker'а. Redis обязателен для расписания;
 * без REDIS_URL честно отказываемся, а не притворяемся.
 */
async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'];
  if (redisUrl === undefined) {
    // eslint-disable-next-line no-console
    console.warn('REDIS_URL не задан: расписание BullMQ выключено. Обработчики тестируются без Redis (vitest).');
    return;
  }
  const { worker } = await bootstrap(redisUrl);
  // eslint-disable-next-line no-console
  console.log(`Sana Guard worker: очередь запущена (${redisUrl})`);
  worker.on('completed', (job) => {
    // eslint-disable-next-line no-console
    console.log(`[${job.name}] выполнено`, JSON.stringify(job.returnvalue));
  });
  worker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`[${job?.name ?? '?'}] ошибка:`, error.message);
  });
}

void main();
