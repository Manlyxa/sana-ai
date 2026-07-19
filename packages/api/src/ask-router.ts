import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { askSana } from '@sana/agents';
import type { ApiContext } from './context';

/**
 * «Спроси Sana» (§10): ответ со ссылкой на норму НК. Числовые вопросы
 * агент направляет к калькуляторам (§11) — деньги считает код, не LLM.
 * LLM (если подключена по ANTHROPIC_API_KEY) только переформулирует ответ
 * базы знаний; норму и тему выбирает код, а расчёты уходят калькуляторам.
 */

const t = initTRPC.context<ApiContext>().create();

export const askRouter = t.router({
  question: t.procedure.input(z.object({ вопрос: z.string().min(3) })).mutation(async ({ ctx, input }) => {
    const answer = await askSana(input.вопрос, ctx.llm);
    switch (answer.kind) {
      case 'ANSWER':
        return {
          тип: 'ответ' as const,
          текст: answer.text,
          норма: answer.citation,
          источник: answer.source,
        };
      case 'CALCULATOR':
        return {
          тип: 'калькулятор' as const,
          текст: answer.text,
          норма: answer.citation,
          калькулятор: answer.calculator,
          эндпоинт: `calculators.${answer.calculator}` as const,
        };
      case 'UNKNOWN':
        return { тип: 'не знаю' as const, текст: answer.text };
    }
  }),
});
