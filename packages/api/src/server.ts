import Fastify, { type FastifyInstance } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './router';
import type { ApiContext } from './context';

/** HTTP-сервер: tRPC под /trpc + health. */
export async function createServer(ctx: ApiContext): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: () => ctx,
    },
  });
  server.get('/health', () => ({ status: 'ok' }));
  return server;
}
