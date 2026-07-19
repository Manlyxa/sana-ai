import { chatLog } from '../../lib/server';
import { askAction } from '../actions';

export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  'Могу ли я списать аренду офиса?',
  'Когда вставать на учёт по НДС?',
  'Что если пропущу срок 910.00?',
  'Сколько ИПН удержать с зарплаты 250000?',
];

/**
 * Спроси Sana (§10): вопрос по-русски → ответ со ссылкой на норму НК.
 * Расчёты агент не делает — направляет к калькуляторам (§11).
 */
export default async function AskPage() {
  const log = chatLog();

  return (
    <section>
      <p className="page-sub">Вопрос на русском — ответ со ссылкой на статью Налогового кодекса.</p>

      <div className="mb-3.5 flex flex-wrap gap-2">
        {SUGGESTIONS.map((q) => (
          <form key={q} action={askAction}>
            <input type="hidden" name="question" value={q} />
            <button
              type="submit"
              className="rounded-full border border-teal-100 bg-teal-050 px-3 py-1.5 text-[12px] font-medium text-teal-700 hover:bg-teal-100"
            >
              {q}
            </button>
          </form>
        ))}
      </div>

      <div className="listcard flex min-h-[420px] flex-col">
        <div className="flex flex-1 flex-col gap-3.5 p-5">
          <div className="max-w-[78%] self-start rounded-2xl rounded-bl-sm border border-border-soft bg-paper px-3.5 py-2.5 text-[13.5px] leading-relaxed">
            Здравствуйте! Я Sana. Спросите про вычеты, сроки или расчёт налогов — отвечу со ссылкой на
            статью Налогового кодекса. Считать буду не я, а калькуляторы — так надёжнее.
          </div>
          {log.map((m, i) =>
            m.role === 'user' ? (
              <div
                key={i}
                className="max-w-[78%] self-end rounded-2xl rounded-br-sm bg-indigo-deep px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white"
              >
                {m.text}
              </div>
            ) : (
              <div
                key={i}
                className="max-w-[78%] self-start rounded-2xl rounded-bl-sm border border-border-soft bg-paper px-3.5 py-2.5 text-[13.5px] leading-relaxed"
              >
                {m.text}
                {m.cite !== null && (
                  <span className="mt-2 block">
                    <span className="badge-teal">{m.cite}</span>
                  </span>
                )}
              </div>
            ),
          )}
        </div>
        <form action={askAction} className="flex gap-2.5 border-t border-border-soft p-3.5">
          <input
            type="text"
            name="question"
            placeholder="Например: могу ли я списать бензин на служебный автомобиль?"
            className="input-mock flex-1"
            autoComplete="off"
          />
          <button type="submit" className="btn-primary">
            Спросить
          </button>
        </form>
      </div>
    </section>
  );
}
