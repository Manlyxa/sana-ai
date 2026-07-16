import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Money, Rate, createJustification, unwrap, type Finding, LocalDate } from '@sana/domain';
import { MockLlmAdapter } from '@sana/adapters';
import {
  HUMAN_REVIEW_CONFIDENCE_THRESHOLD,
  interpretNotice,
} from './notice-interpreter';
import { simulateRegimes, type RegimeSimulationParams } from './regime-simulation';
import { adviseRegime } from './regime-advisor';
import { explainFinding } from './explainer';

const NOTICE_TEXT = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/kgd/uvedomlenie-001.txt'),
  'utf8',
);

const interpretation = {
  noticeNumber: 'UVD-2026-031845',
  subject: 'Расхождения между ф.300.00 за 4 кв. 2025 и данными ИС ЭСФ',
  periodCode: '2025-Q4',
  discrepancyAmountTiyn: '276000000',
  responseDeadlineWorkingDays: 30,
  requiredAction: 'Представить дополнительную ф.300.00 или пояснение по расхождениям',
  draftResponse:
    'В Управление государственных доходов по Алмалинскому району г. Алматы. В ответ на уведомление № UVD-2026-031845 сообщаем: [пояснение причин расхождения].',
  confidence: 0.92,
};

describe('NoticeInterpreter (P1)', () => {
  it('интерпретирует фикстурное уведомление КГД в структуру', async () => {
    const llm = new MockLlmAdapter({ 'kgd-notice-interpretation': interpretation });
    const result = unwrap(await interpretNotice(llm, NOTICE_TEXT));
    expect(result.notice.noticeNumber).toBe('UVD-2026-031845');
    expect(result.notice.periodCode).toBe('2025-Q4');
    expect(result.notice.discrepancyAmountTiyn).toBe('276000000'); // 2 760 000 ₸
    expect(result.notice.responseDeadlineWorkingDays).toBe(30);
    expect(result.needsHumanReview).toBe(false);
  });

  it('низкая уверенность маршрутизирует человеку (P1)', async () => {
    const llm = new MockLlmAdapter({
      'kgd-notice-interpretation': { ...interpretation, confidence: 0.5 },
    });
    const result = unwrap(await interpretNotice(llm, NOTICE_TEXT));
    expect(result.needsHumanReview).toBe(true);
    expect(HUMAN_REVIEW_CONFIDENCE_THRESHOLD).toBe(0.75);
  });

  it('мусорный ответ модели → ошибка, а не мусор в системе', async () => {
    const llm = new MockLlmAdapter({
      'kgd-notice-interpretation': { ...interpretation, confidence: 'высокая' },
    });
    const r = await interpretNotice(llm, NOTICE_TEXT);
    expect(r.ok).toBe(false);
  });
});

const params: RegimeSimulationParams = {
  mrp: Money.ofMajor(4_325),
  kpnRate: Rate.percent(20),
  vatRate: Rate.percent(16),
  snrRate: Rate.percent(4),
  snrAnnualIncomeLimitMrp: 600_000,
  paramsVersion: 'legal-params@2026-01-01',
};

describe('simulateRegimes — детерминированная симуляция (P1)', () => {
  it('малый бизнес: упрощёнка дешевле; числа точны', () => {
    // 5 млн ₸/мес, расходы 40%, 24 месяца: выручка 120 млн
    const sim = unwrap(
      simulateRegimes(
        {
          monthlyRevenue: Money.ofMajor(5_000_000),
          deductibleExpenseShare: Rate.percent(40),
          vatPayerCustomerShare: Rate.percent(20),
          horizonMonths: 24,
        },
        params,
      ),
    );
    // ОУР: КПН = 20% × 72 млн = 14.4 млн; НДС нетто = 16% × 72 млн = 11.52 млн
    expect(sim.our.kpn.equals(Money.ofMajor(14_400_000))).toBe(true);
    expect(sim.our.vatNet.equals(Money.ofMajor(11_520_000))).toBe(true);
    expect(sim.our.total.equals(Money.ofMajor(25_920_000))).toBe(true);
    // Упрощёнка: 4% × 120 млн = 4.8 млн (годовая выручка 60 млн ≤ 2 595 млн лимита)
    expect(sim.uproshchenka.available).toBe(true);
    expect(sim.uproshchenka.tax.equals(Money.ofMajor(4_800_000))).toBe(true);
    expect(sim.cheaper).toBe('СНР_УПРОЩЁНКА');
    expect(sim.savings.equals(Money.ofMajor(21_120_000))).toBe(true);
    // Зачёт покупателей-плательщиков НДС под риском: 16% × 20% × 120 млн = 3.84 млн
    expect(sim.customerVatCreditAtRisk.equals(Money.ofMajor(3_840_000))).toBe(true);
  });

  it('крупный бизнес: упрощёнка недоступна по лимиту', () => {
    // 250 млн ₸/мес → 3 млрд в год > 600 000 МРП = 2 595 млн
    const sim = unwrap(
      simulateRegimes(
        {
          monthlyRevenue: Money.ofMajor(250_000_000),
          deductibleExpenseShare: Rate.percent(60),
          vatPayerCustomerShare: Rate.percent(90),
          horizonMonths: 24,
        },
        params,
      ),
    );
    expect(sim.uproshchenka.available).toBe(false);
    expect(sim.cheaper).toBe('НЕТ_ВЫБОРА');
    expect(sim.uproshchenka.unavailableReason).toContain('лимит');
  });

  it('отвергает невалидный горизонт и отрицательную выручку', () => {
    const base = {
      monthlyRevenue: Money.ofMajor(1),
      deductibleExpenseShare: Rate.percent(0),
      vatPayerCustomerShare: Rate.percent(0),
    };
    expect(simulateRegimes({ ...base, horizonMonths: 0 }, params).ok).toBe(false);
    expect(simulateRegimes({ ...base, horizonMonths: 61 }, params).ok).toBe(false);
    expect(
      simulateRegimes({ ...base, monthlyRevenue: Money.ofMajor(-1), horizonMonths: 12 }, params).ok,
    ).toBe(false);
  });
});

describe('RegimeAdvisor: LLM советует поверх готовых чисел', () => {
  const input = {
    monthlyRevenue: Money.ofMajor(5_000_000),
    deductibleExpenseShare: Rate.percent(40),
    vatPayerCustomerShare: Rate.percent(80),
    horizonMonths: 24,
  };

  it('возвращает симуляцию + совет; фиксирует расхождение с числами', async () => {
    const llm = new MockLlmAdapter({
      'regime-advice': {
        recommendation: 'ОУР',
        rationale:
          '80% ваших покупателей — плательщики НДС: на упрощёнке они потеряют зачёт и могут уйти, что перевесит экономию.',
        caveats: ['Окончательное решение — за владельцем с консультантом (A0).'],
      },
    });
    const result = unwrap(await adviseRegime(llm, input, params));
    expect(result.simulation.cheaper).toBe('СНР_УПРОЩЁНКА'); // по деньгам
    expect(result.advice.recommendation).toBe('ОУР'); // по сумме факторов
    expect(result.divergesFromNumbers).toBe(true);
    expect(result.advice.caveats.length).toBeGreaterThanOrEqual(1);
  });

  it('ошибка LLM пробрасывается', async () => {
    const r = await adviseRegime(new MockLlmAdapter({}), input, params);
    expect(r.ok).toBe(false);
  });
});

describe('Explainer: объяснение никогда не блокирует ленту', () => {
  const finding: Finding = {
    id: 'VAT_CREDIT_NOTICE_MISSING:inv-1',
    ruleId: 'VAT_CREDIT_NOTICE_MISSING',
    companyId: 'demo-too',
    severity: 'CRITICAL',
    asOf: unwrap(LocalDate.parse('2026-05-10')),
    exposure: Money.ofMajor(384_000),
    message: 'Вы теряете 384 000 ₸ зачёта НДС, если не отправите извещение до 2026-05-15.',
    justification: unwrap(
      createJustification({
        norm: 'п. 8 ст. 480 НК РК',
        sourceDocuments: [{ system: 'ИС_ЭСФ', documentType: 'ЭСФ', documentId: 'ESF-IN-2026-0001' }],
        parameterVersion: 'legal-params@2026-05-10',
        explanation: 'Извещение о зачёте не отправлено.',
      }),
    ),
    remediation: { kind: 'SEND_VAT_CREDIT_NOTICE', description: 'Отправить извещение', autonomyLevel: 'A3' },
  };

  it('LLM доступна → человеческое предложение', async () => {
    const llm = new MockLlmAdapter({
      'finding-explanation': {
        sentence: 'По счёту от «Караганда Металл» не отправлено извещение о зачёте — без него 15 мая вы безвозвратно потеряете 384 000 ₸ НДС.',
      },
    });
    const e = await explainFinding(llm, finding);
    expect(e.source).toBe('llm');
    expect(e.sentence).toContain('384 000');
  });

  it('LLM недоступна → детерминированный фолбэк из message (не ошибка)', async () => {
    const e = await explainFinding(new MockLlmAdapter({}), finding);
    expect(e.source).toBe('fallback');
    expect(e.sentence).toBe(finding.message);
  });
});
