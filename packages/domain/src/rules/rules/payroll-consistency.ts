import { findEmployee } from '../context';
import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

/** Сверка внешней (1С) расчётной ведомости с требованиями закона. */

const IPN_ID = 'IPN_DEDUCTION_NO_APPLICATION';

/**
 * Стандартный вычет 30 МРП применён, а письменного заявления работника нет.
 * Экспозиция — недоудержанный ИПН: 10% × 30 МРП за каждый месяц.
 */
export const ipnDeductionNoApplication = defineRule({
  id: IPN_ID,
  severity: 'MEDIUM',
  norm: 'ст. 346 НК РК (вычет — только по заявлению)',
  evaluate: (ctx, asOf) =>
    ctx.externalPayroll
      .filter((rec) => {
        if (!rec.standardDeductionApplied) return false;
        const employee = findEmployee(ctx, rec.employeeIin);
        return employee !== undefined && employee.ipnDeductionApplicationAt === null;
      })
      .map((rec) => {
        const deduction = ctx.law.mrp.multiply(ctx.law.ipnStandardDeductionMrpPerMonth);
        const exposure = deduction.percent(ctx.law.ipnBracket1Rate);
        return makeFinding(ctx, asOf, {
          ruleId: IPN_ID,
          severity: 'MEDIUM',
          norm: 'ст. 346 НК РК (вычет — только по заявлению)',
          subjectId: `${rec.employeeIin.value}:${rec.period.code()}`,
          exposure,
          message: `За ${rec.period.code()} применён вычет 30 МРП по ИИН ${rec.employeeIin.value}, но заявления работника нет. Недоудержан ИПН ${formatTenge(exposure)}.`,
          sourceDocuments: [{ system: '1С', documentType: 'расчётная ведомость', documentId: rec.period.code() }],
          remediation: {
            kind: 'OBTAIN_DEDUCTION_APPLICATION',
            description: 'Получить заявление работника или пересчитать ИПН',
            autonomyLevel: 'A2',
          },
        });
      }),
});

const OPVR_ID = 'OPVR_AGE_EXEMPTION_VIOLATED';

/**
 * ОПВР начислен за работника, родившегося до 1975-01-01 (освобождён).
 * Экспозиция — переплата (начисленный ОПВР).
 */
export const opvrAgeExemptionViolated = defineRule({
  id: OPVR_ID,
  severity: 'MEDIUM',
  norm: 'ст. 251 Социального кодекса РК',
  evaluate: (ctx, asOf) =>
    ctx.externalPayroll
      .filter((rec) => {
        if (!rec.opvrCharged.isPositive()) return false;
        const employee = findEmployee(ctx, rec.employeeIin);
        return (
          employee !== undefined && employee.birthDate.isBefore(ctx.law.opvrExemptIfBornBefore)
        );
      })
      .map((rec) =>
        makeFinding(ctx, asOf, {
          ruleId: OPVR_ID,
          severity: 'MEDIUM',
          norm: 'ст. 251 Социального кодекса РК',
          subjectId: `${rec.employeeIin.value}:${rec.period.code()}`,
          exposure: rec.opvrCharged,
          message: `ОПВР ${formatTenge(rec.opvrCharged)} за ${rec.period.code()} начислен по ИИН ${rec.employeeIin.value}, хотя работник родился до 01.01.1975 и освобождён. Переплата.`,
          sourceDocuments: [{ system: '1С', documentType: 'расчётная ведомость', documentId: rec.period.code() }],
          remediation: {
            kind: 'ADJUST_PAYROLL',
            description: 'Скорректировать начисление и вернуть переплату',
            autonomyLevel: 'A2',
          },
        }),
      ),
});
