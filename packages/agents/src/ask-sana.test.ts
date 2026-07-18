import { describe, expect, it } from 'vitest';
import { MockLlmAdapter } from '@sana/adapters';
import { askSana } from './ask-sana';

describe('Спроси Sana (§10)', () => {
  it('отвечает со ссылкой на норму без LLM (база знаний)', async () => {
    const answer = await askSana('Могу ли я списать аренду офиса?', null);
    expect(answer.kind).toBe('ANSWER');
    if (answer.kind !== 'ANSWER') return;
    expect(answer.text).toContain('7210');
    expect(answer.citation).toContain('НК РК');
    expect(answer.source).toBe('knowledge-base');
  });

  it('вопрос о сумме маршрутизируется к калькулятору — агент не считает сам', async () => {
    const answer = await askSana('Сколько ИПН я должен удержать с зарплаты 250000?', null);
    expect(answer.kind).toBe('CALCULATOR');
    if (answer.kind !== 'CALCULATOR') return;
    expect(answer.calculator).toBe('ipn');
    expect(answer.citation).toContain('ст. 320');
    // В тексте нет посчитанной суммы — только направление к калькулятору.
    expect(answer.text).not.toMatch(/\d{2,}/);
  });

  it('вопрос про порог НДС о сумме → калькулятор vatThreshold', async () => {
    const answer = await askSana('Сколько осталось до порога НДС?', null);
    expect(answer.kind).toBe('CALCULATOR');
    if (answer.kind === 'CALCULATOR') expect(answer.calculator).toBe('vatThreshold');
  });

  it('LLM переформулирует, но цитату выбирает код; цифры от LLM отбрасываются', async () => {
    const polite = new MockLlmAdapter({
      'ask-sana-rephrase': { answer: 'Да, аренду можно относить на вычеты — храните договор и акты.' },
    });
    const rephrased = await askSana('Могу ли я списать аренду офиса?', polite);
    if (rephrased.kind !== 'ANSWER') throw new Error('ожидался ANSWER');
    expect(rephrased.source).toBe('llm');
    expect(rephrased.citation).toContain('НК РК'); // цитата из базы, не от LLM

    const sneaky = new MockLlmAdapter({
      'ask-sana-rephrase': { answer: 'Можно, экономия составит 1 250 000 тенге в год.' },
    });
    const guarded = await askSana('Могу ли я списать аренду офиса?', sneaky);
    if (guarded.kind !== 'ANSWER') throw new Error('ожидался ANSWER');
    // LLM попыталась приписать расчёт — ответ вернулся из базы знаний.
    expect(guarded.source).toBe('knowledge-base');
    expect(guarded.text).not.toContain('1 250 000');
  });

  it('ошибка LLM не блокирует ответ (фолбэк на базу)', async () => {
    const broken = new MockLlmAdapter({});
    const answer = await askSana('Когда выписывать ЭСФ?', broken);
    if (answer.kind !== 'ANSWER') throw new Error('ожидался ANSWER');
    expect(answer.source).toBe('knowledge-base');
    expect(answer.citation).toContain('ст. 493');
  });

  it('незнакомая тема — честный отказ, не выдумка', async () => {
    const answer = await askSana('Как оформить франшизу в Дубае?', null);
    expect(answer.kind).toBe('UNKNOWN');
  });
});
