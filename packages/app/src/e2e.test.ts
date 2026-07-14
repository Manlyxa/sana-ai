import { describe, expect, it } from 'vitest';
import {
  Bin,
  createCompany,
  LocalDate,
  Money,
  unwrap,
  type Company,
} from '@sana/domain';
import { buildRuleLawParams, createSeededStore } from '@sana/legal-params';
import {
  DEMO_IBAN,
  FixtureBankAdapter,
  FixtureCounterpartyRegistryAdapter,
  FixtureEnbekAdapter,
  FixtureEsfAdapter,
  FixtureTaxCabinetAdapter,
} from '@sana/adapters';
import { runComplianceCheck, type CompliancePorts } from './compliance-check';

/**
 * СКВОЗНОЙ ТЕСТ ФАЗЫ 5 (§9): фикстуры → адаптеры → теневой регистр →
 * проекции → правила → находки с экспозицией в тенге.
 * Ни одного внешнего креденшала. Демо-ТОО на ОУР с НДС, 12 работников.
 */

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const AS_OF = D('2026-05-10');

function demoCompany(): Company {
  return unwrap(
    createCompany({
      id: 'demo-too',
      bin: unwrap(Bin.parse('120540000001')),
      name: 'ТОО «Демо Трейд»',
      oked: ['46739'],
      taxRegime: 'ОУР',
      vatStatus: { registered: true, since: D('2024-01-01') },
      reportingStandard: 'НСФО',
      accountingPolicy: { vatCreditMethod: 'ПРОПОРЦИОНАЛЬНЫЙ' },
      employeeCount: 12,
    }),
  );
}

function fixturePorts(): CompliancePorts {
  return {
    esf: new FixtureEsfAdapter(),
    bank: new FixtureBankAdapter(),
    taxCabinet: new FixtureTaxCabinetAdapter(),
    enbek: new FixtureEnbekAdapter(),
    registry: new FixtureCounterpartyRegistryAdapter(),
  };
}

describe('end-to-end на фикстурах', () => {
  it('весь конвейер MVP работает без внешних систем; срабатывает ≥ 6 правил', async () => {
    const law = unwrap(buildRuleLawParams(createSeededStore(), AS_OF));
    const result = unwrap(
      await runComplianceCheck(fixturePorts(), {
        company: demoCompany(),
        accountIban: DEMO_IBAN,
        law,
        asOf: AS_OF,
      }),
    );

    // Теневой регистр: 5 ЭСФ-событий (черновик не событие) + 8 банковских
    expect(result.eventStore.size).toBe(13);

    // Двойной регистр (P7): проводки по всем событиям, налоговые регистры — по ЭСФ
    expect(result.journal).toHaveLength(13);
    expect(result.taxRegisters.length).toBeGreaterThanOrEqual(8);
    for (const je of result.journal) {
      expect(result.eventStore.all().some((e) => e.id === je.businessEventId)).toBe(true);
    }

    // Правила: минимум 6 разных правил MVP сработали на демо-данных (§11)
    const firedRules = [...new Set(result.findings.map((f) => f.ruleId))].sort();
    expect(firedRules).toEqual([
      'COUNTERPARTY_HIGH_RISK',
      'EMPLOYMENT_CONTRACT_NOT_REGISTERED',
      'ESF_CONFIRMATION_PENDING',
      'ESF_ISSUE_OVERDUE',
      'FILING_DEADLINE_APPROACHING',
      'PAYMENT_OVERDUE',
      'SNR_SUPPLIER_DEDUCTION',
      'TAX_NOTICE_UNANSWERED',
      'VAT_CREDIT_NOTICE_MISSING',
    ]);
    expect(firedRules.length).toBeGreaterThanOrEqual(6);

    // Лента отсортирована по тенге под риском
    for (let i = 1; i < result.findings.length; i++) {
      expect(
        result.findings[i - 1]!.exposure.compareTo(result.findings[i]!.exposure),
      ).toBeGreaterThanOrEqual(0);
    }

    // Каждая находка полна: деньги, норма, документы, remediation, автономность
    for (const f of result.findings) {
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.justification.norm).toBeTruthy();
      expect(f.justification.parameterVersion).toBe('legal-params@2026-05-10');
      expect(f.justification.sourceDocuments.length).toBeGreaterThan(0);
      expect(f.remediation.autonomyLevel).toMatch(/^A[0-3]$/);
    }

    // Контрольные суммы: главная находка — ФНО 300 на 2 340 000 ₸
    const top = result.findings[0]!;
    expect(top.ruleId).toBe('FILING_DEADLINE_APPROACHING');
    expect(top.exposure.equals(Money.ofMajor(2_340_000))).toBe(true);

    // Потерянный зачёт НДС по неотправленным извещениям: 384 000 + 152 000
    const vatFindings = result.findings.filter((f) => f.ruleId === 'VAT_CREDIT_NOTICE_MISSING');
    const vatExposure = vatFindings.reduce((acc, f) => acc.add(f.exposure), Money.zero());
    expect(vatExposure.equals(Money.ofMajor(536_000))).toBe(true);

    // Рисковый контрагент: НДС 288 000 + КПН 360 000
    const risky = result.findings.find((f) => f.ruleId === 'COUNTERPARTY_HIGH_RISK')!;
    expect(risky.exposure.equals(Money.ofMajor(648_000))).toBe(true);
    expect(risky.message).toContain('Фантом Групп');

    // Суммарная экспозиция демо — реалистичные миллионы тенге
    const total = result.findings.reduce((acc, f) => acc.add(f.exposure), Money.zero());
    expect(total.compareTo(Money.ofMajor(4_000_000))).toBeGreaterThan(0);
  });

  it('повторный прогон идемпотентен (те же находки, те же id)', async () => {
    const law = unwrap(buildRuleLawParams(createSeededStore(), AS_OF));
    const input = { company: demoCompany(), accountIban: DEMO_IBAN, law, asOf: AS_OF };
    const a = unwrap(await runComplianceCheck(fixturePorts(), input));
    const b = unwrap(await runComplianceCheck(fixturePorts(), input));
    expect(b.findings.map((f) => f.id)).toEqual(a.findings.map((f) => f.id));
    expect(b.journal).toEqual(a.journal);
    expect(b.taxRegisters).toEqual(a.taxRegisters);
  });

  it('ошибка любого порта пробрасывается как Err, а не глотается', async () => {
    const law = unwrap(buildRuleLawParams(createSeededStore(), AS_OF));
    const input = { company: demoCompany(), accountIban: DEMO_IBAN, law, asOf: AS_OF };
    const bad = '/nonexistent-fixtures';
    const base = fixturePorts();
    const broken: CompliancePorts[] = [
      { ...base, esf: new FixtureEsfAdapter(bad) },
      { ...base, bank: new FixtureBankAdapter(bad) },
      { ...base, taxCabinet: new FixtureTaxCabinetAdapter(bad) },
      { ...base, enbek: new FixtureEnbekAdapter(bad) },
      { ...base, registry: new FixtureCounterpartyRegistryAdapter(bad) },
    ];
    for (const ports of broken) {
      const r = await runComplianceCheck(ports, input);
      expect(r.ok).toBe(false);
    }
  });

  it('исправление первопричины гасит находку (extинкция через diff)', async () => {
    const law = unwrap(buildRuleLawParams(createSeededStore(), AS_OF));
    const ports = fixturePorts();
    const input = { company: demoCompany(), accountIban: DEMO_IBAN, law, asOf: AS_OF };

    const before = unwrap(await runComplianceCheck(ports, input));
    const hadNotice = before.findings.some(
      (f) => f.id === 'VAT_CREDIT_NOTICE_MISSING:ESF-IN-2026-0001',
    );
    expect(hadNotice).toBe(true);

    // Ремедиация A3: отправить извещение о зачёте
    unwrap(await ports.esf.sendVatCreditNotice('ESF-IN-2026-0001'));

    const after = unwrap(await runComplianceCheck(ports, input));
    expect(
      after.findings.some((f) => f.id === 'VAT_CREDIT_NOTICE_MISSING:ESF-IN-2026-0001'),
    ).toBe(false);
  });
});
