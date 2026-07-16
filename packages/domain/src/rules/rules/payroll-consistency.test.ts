import { describe, expect, it } from 'vitest';
import { ipnDeductionNoApplication, opvrAgeExemptionViolated } from './payroll-consistency';
import { Money } from '../../kernel/money';
import { TaxPeriod } from '../../kernel/tax-period';
import { D, testEmployee, testRuleContext, TEST_IIN_1970, TEST_IIN_1990 } from '../../testing/fixtures';
import type { ExternalPayrollRecord } from '../context';

const march = TaxPeriod.month(2026, 3);

function record(overrides: Partial<ExternalPayrollRecord> = {}): ExternalPayrollRecord {
  return {
    employeeIin: TEST_IIN_1990,
    period: march,
    gross: Money.ofMajor(200_000),
    standardDeductionApplied: true,
    opvrCharged: Money.zero(),
    ...overrides,
  };
}

describe('IPN_DEDUCTION_NO_APPLICATION (ст. 346 НК РК)', () => {
  it('СРАБАТЫВАЕТ: вычет применён без заявления; экспозиция = 10% × 30 МРП', () => {
    const ctx = testRuleContext({
      employees: [testEmployee({ ipnDeductionApplicationAt: null })],
      externalPayroll: [record()],
    });
    const findings = ipnDeductionNoApplication.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(12_975))).toBe(true);
  });

  it('НЕ СРАБАТЫВАЕТ: заявление есть или вычет не применялся', () => {
    const withApp = testRuleContext({
      employees: [testEmployee()],
      externalPayroll: [record()],
    });
    expect(ipnDeductionNoApplication.evaluate(withApp, D('2026-04-01'))).toEqual([]);

    const notApplied = testRuleContext({
      employees: [testEmployee({ ipnDeductionApplicationAt: null })],
      externalPayroll: [record({ standardDeductionApplied: false })],
    });
    expect(ipnDeductionNoApplication.evaluate(notApplied, D('2026-04-01'))).toEqual([]);
  });
});

describe('OPVR_AGE_EXEMPTION_VIOLATED (Социальный кодекс РК)', () => {
  const born1970 = testEmployee({ iin: TEST_IIN_1970, birthDate: D('1970-03-01') });

  it('СРАБАТЫВАЕТ: ОПВР начислен за работника 1970 г.р.; экспозиция = переплата', () => {
    const ctx = testRuleContext({
      employees: [born1970],
      externalPayroll: [record({ employeeIin: TEST_IIN_1970, opvrCharged: Money.ofMajor(7_000) })],
    });
    const findings = opvrAgeExemptionViolated.evaluate(ctx, D('2026-04-01'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.exposure.equals(Money.ofMajor(7_000))).toBe(true);
  });

  it('НЕ СРАБАТЫВАЕТ: работник 1990 г.р. или ОПВР не начислялся', () => {
    const young = testRuleContext({
      employees: [testEmployee()],
      externalPayroll: [record({ opvrCharged: Money.ofMajor(7_000) })],
    });
    expect(opvrAgeExemptionViolated.evaluate(young, D('2026-04-01'))).toEqual([]);

    const zero = testRuleContext({
      employees: [born1970],
      externalPayroll: [record({ employeeIin: TEST_IIN_1970 })],
    });
    expect(opvrAgeExemptionViolated.evaluate(zero, D('2026-04-01'))).toEqual([]);
  });
});
