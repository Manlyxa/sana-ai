import { z } from 'zod';
import { err, ok, type Result } from '@sana/domain';
import type { LlmPort, LlmSchema, PortError } from '@sana/ports';
import {
  simulateRegimes,
  type RegimeSimulationInput,
  type RegimeSimulationParams,
  type RegimeSimulationResult,
} from './regime-simulation';

/**
 * RegimeAdvisor: детерминированная симуляция считает деньги, LLM — только
 * советует поверх готовых чисел (учёт нефинансовых факторов: зачёт НДС у
 * покупателей, административная нагрузка). Решение о смене режима — A0:
 * принимает человек.
 */

export type RegimeAdvice = {
  readonly recommendation: 'ОУР' | 'СНР_УПРОЩЁНКА';
  readonly rationale: string;
  readonly caveats: readonly string[];
};

export type RegimeAdvisorResult = {
  readonly simulation: RegimeSimulationResult;
  readonly advice: RegimeAdvice;
  /** true, если совет расходится с чисто денежным итогом симуляции. */
  readonly divergesFromNumbers: boolean;
};

const adviceZod = z.object({
  recommendation: z.enum(['ОУР', 'СНР_УПРОЩЁНКА']),
  rationale: z.string().min(20),
  caveats: z.array(z.string()).min(1),
});

export const regimeAdviceSchema: LlmSchema<RegimeAdvice> = {
  name: 'regime-advice',
  description: 'Рекомендация налогового режима для ТОО в РК',
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['recommendation', 'rationale', 'caveats'],
    properties: {
      recommendation: { type: 'string', enum: ['ОУР', 'СНР_УПРОЩЁНКА'] },
      rationale: { type: 'string' },
      caveats: { type: 'array', items: { type: 'string' } },
    },
  },
  parse: (raw) => {
    const parsed = adviceZod.safeParse(raw);
    return parsed.success ? ok(parsed.data) : err(parsed.error.message);
  },
};

function buildPrompt(sim: RegimeSimulationResult, input: RegimeSimulationInput): string {
  return `Ты — налоговый консультант для ТОО в Казахстане. Ниже — РЕЗУЛЬТАТ
ДЕТЕРМИНИРОВАННОЙ СИМУЛЯЦИИ налоговой нагрузки за ${sim.horizonMonths} месяцев
(версия параметров закона: ${sim.paramsVersion}). Числа НЕ пересчитывай — они уже
посчитаны кодом. Твоя задача — взвесить нефинансовые факторы и дать рекомендацию.

ОУР: КПН ${sim.our.kpn.toDecimalString()} ₸ + НДС нетто ${sim.our.vatNet.toDecimalString()} ₸ = ${sim.our.total.toDecimalString()} ₸.
Упрощёнка: ${sim.uproshchenka.available ? `${sim.uproshchenka.tax.toDecimalString()} ₸` : `НЕДОСТУПНА (${sim.uproshchenka.unavailableReason})`}.
Дешевле по деньгам: ${sim.cheaper}${sim.uproshchenka.available ? `, экономия ${sim.savings.toDecimalString()} ₸` : ''}.

Ключевой нефинансовый фактор: доля покупателей-плательщиков НДС —
${input.vatPayerCustomerShare.toPercentString()}. На упрощёнке компания не выставляет НДС,
и эти покупатели теряют зачёт ~${sim.customerVatCreditAtRisk.toDecimalString()} ₸ за горизонт —
риск потери клиентов или требования скидки.

Дай recommendation (ОУР или СНР_УПРОЩЁНКА), rationale (по-русски, для владельца,
со ссылкой на числа выше) и caveats (минимум одно предостережение; обязательно
напомни, что окончательное решение принимает человек с консультантом — уровень A0).`;
}

export async function adviseRegime(
  llm: LlmPort,
  input: RegimeSimulationInput,
  params: RegimeSimulationParams,
): Promise<Result<RegimeAdvisorResult, PortError>> {
  const simulated = simulateRegimes(input, params);
  if (!simulated.ok) return err({ kind: 'VALIDATION', message: simulated.error.message });
  const sim = simulated.value;

  const advice = await llm.complete(buildPrompt(sim, input), regimeAdviceSchema);
  if (!advice.ok) return advice;

  return ok({
    simulation: sim,
    advice: advice.value,
    divergesFromNumbers:
      sim.cheaper !== 'НЕТ_ВЫБОРА' && advice.value.recommendation !== sim.cheaper,
  });
}
