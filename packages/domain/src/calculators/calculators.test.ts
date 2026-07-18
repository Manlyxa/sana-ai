import { describe, expect, it } from 'vitest';
import { Money } from '../kernel/money';
import { Rate } from '../kernel/rate';
import { unwrap } from '../kernel/result';
import { computePayrollMonth, cumulativeIpn } from '../payroll/engine';
import { emptyYtd } from '../payroll/params';
import { D, payrollParams2026, ruleLawParams2026, testCompany, testEmployee, testInvoice, testRuleContext } from '../testing/fixtures';
import { vatThresholdBreached } from '../rules/rules/vat-threshold';
import { calculateIpnMonth, calculateLatePenalty, calculateVatThreshold } from './calculators';

const params = payrollParams2026();

describe('калькулятор ИПН (нарастающим итогом)', () => {
  it('считает ТОЙ ЖЕ функцией, что и зарплатный движок (эквивалентность)', () => {
    // Пенсионер освобождён от ОПВ/ВОСМС и не имеет вычетов: облагаемая
    // база месяца равна начислению — вход калькулятора совпадает со входом
    // движка, значит и ИПН обязан совпасть до тиына.
    const pensioner = testEmployee({ pensionerByAge: true, ipnDeductionApplicationAt: null });
    const gross = Money.ofMajor(437_651);
    const prevYtd = { ...emptyYtd(), cumTaxableIncome: Money.ofMajor(2_611_007), cumIpn: cumulativeIpn(Money.ofMajor(2_611_007), params) };
    const engine = unwrap(computePayrollMonth({ employee: pensioner, gross, ytd: prevYtd, params }));
    const calc = unwrap(calculateIpnMonth(prevYtd.cumTaxableIncome, gross, params));
    expect(calc.ipnMonth.equals(engine.ipn)).toBe(true);
  });

  it('фиксирует пересечение потолка 8500 МРП в месяце пересечения', () => {
    const ceiling = params.mrp.multiply(params.ipn.bracket1CeilingMrp);
    const before = ceiling.subtract(Money.ofMajor(1_000_000));
    const calc = unwrap(calculateIpnMonth(before, Money.ofMajor(3_000_000), params));
    expect(calc.crossedCeiling).toBe(true);
    // 10% с 1 000 000 до потолка + 15% с 2 000 000 сверх = 100 000 + 300 000.
    expect(calc.ipnMonth.toDecimalString()).toBe('400000.00');
  });

  it('отрицательная база отвергается', () => {
    expect(calculateIpnMonth(Money.ofMajor(-1), Money.ofMajor(1), params).ok).toBe(false);
    expect(calculateIpnMonth(Money.ofMajor(1), Money.ofMajor(-1), params).ok).toBe(false);
  });
});

describe('калькулятор порога НДС', () => {
  const law = ruleLawParams2026();
  const vatParams = { mrp: law.mrp, thresholdMrp: law.vatRegistrationThresholdMrp };

  it('до порога: остаток и занятая доля', () => {
    const calc = unwrap(calculateVatThreshold(Money.ofMajor(34_800_000), vatParams));
    // Порог = 4325 × 10 000 = 43 250 000 ₸.
    expect(calc.threshold.toDecimalString()).toBe('43250000.00');
    expect(calc.remaining.toDecimalString()).toBe('8450000.00');
    expect(calc.breached).toBe(false);
    expect(calc.usedPercent).toBe(80);
  });

  it('после порога: превышение, остаток 0', () => {
    const calc = unwrap(calculateVatThreshold(Money.ofMajor(45_000_000), vatParams));
    expect(calc.breached).toBe(true);
    expect(calc.excess.toDecimalString()).toBe('1750000.00');
    expect(calc.remaining.isZero()).toBe(true);
  });

  it('правило Sana Guard считает превышение той же функцией (цифры совпадают)', () => {
    const ctx = testRuleContext({
      company: testCompany({ vatStatus: { registered: false } }),
      invoices: [
        testInvoice({
          id: 'inv-turnover',
          direction: 'OUT',
          turnoverDate: D('2026-03-01'),
          lines: [
            {
              description: 'услуги',
              total: Money.ofMajor(45_000_000),
              vatRate: Rate.percent(0),
              vatAmount: Money.zero(),
            },
          ],
          totalExVat: Money.ofMajor(45_000_000),
          vatAmount: Money.zero(),
        }),
      ],
    });
    const findings = vatThresholdBreached.evaluate(ctx, D('2026-05-10'));
    expect(findings).toHaveLength(1);
    const calc = unwrap(calculateVatThreshold(Money.ofMajor(45_000_000), vatParams));
    // exposure = штраф 50 МРП + 15% превышения — превышение из той же функции.
    const expected = ctx.law.mrp
      .multiply(ctx.law.fineVatRegistrationMrp)
      .add(calc.excess.percent(Rate.percent(15)));
    expect(findings[0]!.exposure.equals(expected)).toBe(true);
  });
});

describe('калькулятор пени', () => {
  const penaltyParams = {
    annualBaseRate: Rate.percent('16.5'),
    multiplier: Rate.percent(125),
    version: 'legal-params@test',
  };

  it('пеня = недоимка × базовая ставка × 1,25 × дни / 365, в целых тенге', () => {
    const calc = unwrap(calculateLatePenalty(Money.ofMajor(1_044_000), 12, penaltyParams));
    // 1 044 000 × 0,165 × 1,25 × 12 / 365 = 7 079,178… → 7 079 ₸.
    expect(calc.penalty.toDecimalString()).toBe('7079.00');
    expect(calc.effectiveAnnualRate.equals(Rate.percent('20.625'))).toBe(true);
  });

  it('0 дней просрочки → пеня 0', () => {
    const calc = unwrap(calculateLatePenalty(Money.ofMajor(1_000_000), 0, penaltyParams));
    expect(calc.penalty.isZero()).toBe(true);
  });

  it('дробные и отрицательные дни отвергаются', () => {
    expect(calculateLatePenalty(Money.ofMajor(1), 1.5, penaltyParams).ok).toBe(false);
    expect(calculateLatePenalty(Money.ofMajor(1), -3, penaltyParams).ok).toBe(false);
  });
});
