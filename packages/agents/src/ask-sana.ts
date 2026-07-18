import { z } from 'zod';
import { err, ok } from '@sana/domain';
import type { LlmPort, LlmSchema } from '@sana/ports';

/**
 * «Спроси Sana» (§10): вопрос по-русски → ответ со ссылкой на норму.
 *
 * Незыблемое правило: деньги считает код. Агент НИКОГДА не выдаёт
 * числовой расчёт: вопрос, требующий цифры («сколько я должен…»),
 * детерминированно маршрутизируется к калькулятору (§11). LLM (если
 * доступна) только переформулирует ответ базы знаний — норма и тема
 * выбираются кодом, и при любой ошибке LLM ответ базы отдаётся как есть.
 */

export type CalculatorId = 'ipn' | 'vatThreshold' | 'penalty';

export type AskSanaAnswer =
  | {
      readonly kind: 'ANSWER';
      readonly text: string;
      readonly citation: string;
      readonly source: 'llm' | 'knowledge-base';
    }
  | {
      readonly kind: 'CALCULATOR';
      readonly calculator: CalculatorId;
      readonly text: string;
      readonly citation: string;
    }
  | { readonly kind: 'UNKNOWN'; readonly text: string };

type KnowledgeEntry = {
  readonly keywords: readonly string[];
  readonly answer: string;
  readonly citation: string;
  /** Каким калькулятором считать, если вопрос — про сумму. */
  readonly calculator: CalculatorId | null;
};

/**
 * База знаний: нормы согласованы с legal-params и правилами Sana Guard —
 * агент цитирует те же статьи, что движок кладёт в Justification.
 */
const KNOWLEDGE: readonly KnowledgeEntry[] = [
  {
    keywords: ['аренд'],
    answer:
      'Аренда офиса относится на вычеты при наличии договора аренды и акта оказанных услуг; ' +
      'в учёте Sana такие платежи попадают на счёт 7210 «Административные расходы».',
    citation: 'НК РК 2026 — вычеты по КПН; Типовой план счетов РК (счёт 7210)',
    calculator: null,
  },
  {
    keywords: ['ндс', 'порог'],
    answer:
      'Регистрация по НДС обязательна после превышения порога 10 000 МРП оборота ' +
      'нарастающим итогом с начала года; на подачу заявления — 5 рабочих дней.',
    citation: 'ст. 99 НК РК',
    calculator: 'vatThreshold',
  },
  {
    keywords: ['910', 'упрощ'],
    answer:
      'Форма 910.00 сдаётся за полугодие до 15 числа второго месяца после его окончания. ' +
      'За просрочку — предупреждение или штраф, при повторном нарушении суммы растут; ' +
      'если срок уже упущен, сдать всё равно нужно как можно быстрее.',
    citation: 'ст. 728 НК РК; ст. 272 КоАП РК',
    calculator: null,
  },
  {
    keywords: ['эсф', 'счёт-фактур', 'счет-фактур'],
    answer:
      'Электронный счёт-фактура выписывается не позднее 15 календарных дней с даты оборота; ' +
      'для работ и услуг нерезидента — 5 дней.',
    citation: 'ст. 493 НК РК',
    calculator: null,
  },
  {
    keywords: ['ипн', 'зарплат', 'подоходн'],
    answer:
      'ИПН удерживается по прогрессивной шкале нарастающим итогом с начала года: ' +
      '10% до 8500 МРП накопленной базы и 15% сверх. Поэтому месяц нельзя считать изолированно — ' +
      'Sana хранит накопительный итог по каждому сотруднику.',
    citation: 'ст. 320–321 НК РК',
    calculator: 'ipn',
  },
  {
    keywords: ['пен', 'просрочк'],
    answer:
      'Пеня начисляется за каждый день просрочки уплаты в размере 1,25-кратной ' +
      'базовой ставки Нацбанка, действовавшей на день просрочки.',
    citation: 'ст. 104 НК РК',
    calculator: 'penalty',
  },
  {
    keywords: ['контрагент', 'риск', 'лжепредприят'],
    answer:
      'Перед сделкой проверьте контрагента в реестре КГД: по сделкам с лжепредприятиями ' +
      'и рисковыми поставщиками вычеты и зачёт НДС снимаются при проверке.',
    citation: 'ст. 264 НК РК',
    calculator: null,
  },
];

const CALC_INTENT = /сколько|посчита|рассчита|какая сумма|какую сумму|сумма к уплате/i;

const CALC_TEXT: Record<CalculatorId, string> = {
  ipn: 'Точную сумму ИПН посчитает калькулятор «ИПН сотрудника» — той же формулой, что и ведомость зарплаты.',
  vatThreshold:
    'Сколько осталось до порога НДС, посчитает калькулятор «Порог по НДС» — той же функцией, что и Sana Guard.',
  penalty: 'Сумму пени посчитает калькулятор «Пеня за просрочку» — по ставке Нацбанка из параметров закона.',
};

const rephraseZod = z.object({ answer: z.string().min(10).max(600) });

const rephraseSchema: LlmSchema<{ answer: string }> = {
  name: 'ask-sana-rephrase',
  description: 'Переформулированный ответ владельцу бизнеса (без цифр и расчётов)',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer'],
    properties: { answer: { type: 'string' } },
  },
  parse: (raw) => {
    const parsed = rephraseZod.safeParse(raw);
    return parsed.success ? ok(parsed.data) : err(parsed.error.message);
  },
};

function findEntry(question: string): KnowledgeEntry | null {
  const low = question.toLowerCase();
  return KNOWLEDGE.find((e) => e.keywords.some((k) => low.includes(k))) ?? null;
}

export async function askSana(question: string, llm: LlmPort | null): Promise<AskSanaAnswer> {
  const entry = findEntry(question);

  // Вопрос о сумме → калькулятор, не текст с числами.
  if (entry?.calculator != null && CALC_INTENT.test(question)) {
    return {
      kind: 'CALCULATOR',
      calculator: entry.calculator,
      text: CALC_TEXT[entry.calculator],
      citation: entry.citation,
    };
  }

  if (entry === null) {
    return {
      kind: 'UNKNOWN',
      text:
        'По этому вопросу нужно свериться с конкретной нормой — не хочу отвечать наугад. ' +
        'Я уверенно отвечаю про вычеты (аренда), порог по НДС, сроки 910.00, ЭСФ, ИПН, пеню ' +
        'и проверку контрагентов.',
    };
  }

  if (llm !== null) {
    const completed = await llm.complete(
      'Переформулируй ответ для владельца ТОО простым русским языком, одним-двумя предложениями. ' +
        'ЗАПРЕЩЕНО добавлять числа, суммы и расчёты, которых нет в исходном ответе. ' +
        `Вопрос: «${question}». Исходный ответ: «${entry.answer}»`,
      rephraseSchema,
    );
    // Цифры от LLM не принимаются: если появились новые числа — фолбэк.
    if (completed.ok && !hasNewDigits(completed.value.answer, entry.answer)) {
      return { kind: 'ANSWER', text: completed.value.answer, citation: entry.citation, source: 'llm' };
    }
  }
  return { kind: 'ANSWER', text: entry.answer, citation: entry.citation, source: 'knowledge-base' };
}

/** Числа, которых не было в исходном ответе, — признак самодельного расчёта LLM. */
function hasNewDigits(candidate: string, original: string): boolean {
  const digitsOf = (s: string) => s.match(/\d[\d\s]*/g)?.map((d) => d.replace(/\s/g, '')) ?? [];
  const allowed = new Set(digitsOf(original));
  return digitsOf(candidate).some((d) => !allowed.has(d));
}
