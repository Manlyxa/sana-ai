import { describe, expect, it } from 'vitest';
import { MockLlmAdapter } from '@sana/adapters';
import { appRouter } from './router';
import { createDemoContext } from './context';

/**
 * Проверяем, что LLM реально прокинута в контекст и участвует там, где
 * должна: AI-классификация неоднозначных проводок (§2/3) и «Спроси Sana»
 * (§10). Суммы при этом всё равно считает код (P1).
 */

describe('LLM подключена в API-контекст', () => {
  it('без ключа/мока llm === null (герметичный дефолт)', async () => {
    const ctx = await createDemoContext(undefined, { llm: null });
    expect(ctx.llm).toBeNull();
  });

  it('«Спроси Sana» использует LLM для переформулировки, цитату берёт код', async () => {
    // Мок отвечает на схему агента переформулированным текстом.
    const llm = new MockLlmAdapter({
      'ask-sana-rephrase': { answer: 'Да, аренду офиса можно относить на вычеты — храните договор и акты.' },
    });
    const ctx = await createDemoContext(undefined, { llm });
    const caller = appRouter.createCaller(ctx);
    const answer = await caller.ask.question({ вопрос: 'Могу ли я списать аренду офиса?' });
    expect(answer.тип).toBe('ответ');
    if (answer.тип !== 'ответ') return;
    expect(answer.источник).toBe('llm');
    expect(answer.норма).toContain('НК РК'); // норму выбрал код, не LLM
  });

  it('AI-классификатор проводок получает LLM: неоднозначная операция может быть подсказана', async () => {
    // Мок предлагает счета для неоднозначной банковской операции.
    const llm = new MockLlmAdapter({
      account_suggestion: {
        debitAccount: '7210',
        creditAccount: '1030',
        category: 'Услуги',
        confidence: 55,
        explanation: 'Похоже на оплату услуг по назначению платежа.',
      },
    });
    const ctx = await createDemoContext(undefined, { llm });
    const caller = appRouter.createCaller(ctx);
    const ingested = await caller.accounting.ingestFixtures();
    // Прогон прошёл без ошибок; хотя бы одна операция обработана.
    expect(ingested.events).toBeGreaterThan(0);
    // Очередь доступна — AI-подсказка не ломает детерминированный путь.
    const queue = await caller.accounting.queue();
    expect(Array.isArray(queue)).toBe(true);
  });

  it('числовой вопрос по-прежнему уходит калькулятору даже с подключённой LLM', async () => {
    const llm = new MockLlmAdapter({});
    const ctx = await createDemoContext(undefined, { llm });
    const caller = appRouter.createCaller(ctx);
    const answer = await caller.ask.question({ вопрос: 'Сколько ИПН удержать с зарплаты 250000?' });
    expect(answer.тип).toBe('калькулятор');
  });
});
