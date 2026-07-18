import type { Employee } from '../entities/employee';
import { Money } from '../kernel/money';
import { err, ok, type Result } from '../kernel/result';
import {
  isEligibleForIpnDeductions,
  isOosmsExempt,
  isOpvExempt,
  isOpvrExempt,
  isSoExempt,
  isVosmsExempt,
} from './exemptions';
import { emptyYtd, type PayrollLawParams, type YtdRecord } from './params';

/**
 * Зарплатный движок (§6). Детерминированный, чистый, без I/O (P1).
 *
 * ИПН прогрессивен и НАКОПИТЕЛЕН с 1 января: месяц N требует итогов
 * месяцев 1..N−1 (YtdRecord). Ретроактивная корректировка — это пересборка
 * последовательности с месяца 1 (computePayrollSequence).
 *
 * Все суммы платежей исчисляются в целых тенге (HALF_UP).
 */

export type EmployerContributions = {
  readonly opvr: Money;
  readonly so: Money;
  readonly oosms: Money;
  readonly sn: Money;
};

export type PayrollMonthResult = {
  readonly gross: Money;
  readonly opv: Money;
  readonly vosms: Money;
  readonly standardDeduction: Money;
  readonly additionalDeduction: Money;
  readonly taxableIncome: Money;
  readonly ipn: Money;
  readonly net: Money;
  readonly employer: EmployerContributions;
  /** Накопительный итог ПОСЛЕ этого месяца — вход для месяца N+1. */
  readonly ytd: YtdRecord;
  /** Версия параметров закона (для Justification, P3). */
  readonly paramsVersion: string;
};

export type PayrollError = { readonly message: string };

export type PayrollMonthInput = {
  readonly employee: Employee;
  readonly gross: Money;
  readonly ytd: YtdRecord;
  readonly params: PayrollLawParams;
};

/** cap в МЗП → денежный потолок базы. */
function capOf(mzp: Money, capMzp: number): Money {
  return mzp.multiply(capMzp);
}

/**
 * Накопительный ИПН от накопительной базы: 10% до потолка + 15% сверх.
 * Экспортирована, потому что калькулятор ИПН (§11) обязан считать ТОЙ ЖЕ
 * функцией, что и движок, — иначе они разойдутся.
 */
export function cumulativeIpn(cumTaxable: Money, params: PayrollLawParams): Money {
  const ceiling = params.mrp.multiply(params.ipn.bracket1CeilingMrp);
  const below = Money.min(cumTaxable, ceiling);
  const above = Money.max(cumTaxable.subtract(ceiling), Money.zero());
  return below
    .percent(params.ipn.bracket1Rate)
    .roundToMajor()
    .add(above.percent(params.ipn.bracket2Rate).roundToMajor());
}

export function computePayrollMonth(
  input: PayrollMonthInput,
): Result<PayrollMonthResult, PayrollError> {
  const { employee, gross, ytd, params } = input;
  if (gross.isNegative()) {
    return err({ message: `доход за месяц не может быть отрицательным: ${gross.toDecimalString()}` });
  }

  const zero = Money.zero(gross.currency);

  // 1. ОПВ = 10% × min(gross, 50 МЗП)
  const opv = isOpvExempt(employee) || gross.isZero()
    ? zero
    : Money.min(gross, capOf(params.mzp, params.opv.capMzp)).percent(params.opv.rate).roundToMajor();

  // 2. ВОСМС = 2% × min(gross, 20 МЗП)
  const vosms = isVosmsExempt(employee) || gross.isZero()
    ? zero
    : Money.min(gross, capOf(params.mzp, params.vosms.capMzp)).percent(params.vosms.rate).roundToMajor();

  // 3. Вычеты в строгом порядке: (a) ОПВ+ВОСМС, (b) стандартный 30 МРП
  //    только при заявлении, (c) дополнительный (882 МРП/год — инвалидность).
  const baseAfterContributions = Money.max(gross.subtract(opv).subtract(vosms), zero);

  const deductionsAllowed = isEligibleForIpnDeductions(employee);
  const standardDeduction =
    deductionsAllowed && employee.ipnDeductionApplicationAt !== null
      ? Money.min(params.mrp.multiply(params.ipn.standardDeductionMrpPerMonth), baseAfterContributions)
      : zero;

  const baseAfterStandard = baseAfterContributions.subtract(standardDeduction);
  let additionalDeduction = zero;
  if (deductionsAllowed && employee.disability !== null) {
    const annualCap = params.mrp.multiply(params.ipn.additionalDeductionDisabilityMrpAnnual);
    const remaining = Money.max(annualCap.subtract(ytd.cumAdditionalDeductionUsed), zero);
    additionalDeduction = Money.min(remaining, baseAfterStandard);
  }

  // 4. Облагаемый доход месяца
  const taxableIncome = baseAfterStandard.subtract(additionalDeduction);

  // 5. ИПН — прогрессивный, накопительный: месячный = Δ накопительного.
  const cumTaxable = ytd.cumTaxableIncome.add(taxableIncome);
  const cumIpn = cumulativeIpn(cumTaxable, params);
  const ipn = cumIpn.subtract(ytd.cumIpn);

  // 6. На руки
  const net = gross.subtract(opv).subtract(vosms).subtract(ipn);

  // 7. ОПВР — 0 для родившихся до 1975-01-01
  const opvrExempt =
    isOpvrExempt(employee) || employee.birthDate.isBefore(params.opvr.exemptIfBornBefore);
  const opvr = opvrExempt || gross.isZero()
    ? zero
    : Money.min(gross, capOf(params.mzp, params.opvr.capMzp)).percent(params.opvr.rate).roundToMajor();

  // 8. СО = 5% × clamp(gross − ОПВ, 1 МЗП, 7 МЗП); при нулевом доходе — 0.
  const so = isSoExempt(employee) || gross.isZero()
    ? zero
    : gross
        .subtract(opv)
        .clamp(capOf(params.mzp, params.so.floorMzp), capOf(params.mzp, params.so.capMzp))
        .percent(params.so.rate)
        .roundToMajor();

  // 9. ООСМС = 3% × min(gross, 40 МЗП)
  const oosms = isOosmsExempt(employee) || gross.isZero()
    ? zero
    : Money.min(gross, capOf(params.mzp, params.oosms.capMzp)).percent(params.oosms.rate).roundToMajor();

  // 10. СН = 6% × (gross − ОПВ − ВОСМС), зачёт СО отменён с 2026.
  const snBase = Money.max(gross.subtract(opv).subtract(vosms), zero);
  const sn = snBase.percent(params.sn.rate).roundToMajor();

  return ok({
    gross,
    opv,
    vosms,
    standardDeduction,
    additionalDeduction,
    taxableIncome,
    ipn,
    net,
    employer: { opvr, so, oosms, sn },
    ytd: {
      cumTaxableIncome: cumTaxable,
      cumIpn,
      cumAdditionalDeductionUsed: ytd.cumAdditionalDeductionUsed.add(additionalDeduction),
    },
    paramsVersion: params.version,
  });
}

export type PayrollSequenceMonth = {
  readonly gross: Money;
  readonly params: PayrollLawParams;
};

/**
 * Расчёт последовательности месяцев с января (максимум 12).
 * Ретроактивная корректировка = замена входа нужного месяца и полный
 * пересчёт: накопительный итог распространяется сам.
 */
export function computePayrollSequence(
  employee: Employee,
  months: readonly PayrollSequenceMonth[],
): Result<readonly PayrollMonthResult[], PayrollError> {
  if (months.length === 0 || months.length > 12) {
    return err({ message: `последовательность должна содержать 1–12 месяцев, получено ${months.length}` });
  }
  const results: PayrollMonthResult[] = [];
  let ytd = emptyYtd();
  for (const m of months) {
    const r = computePayrollMonth({ employee, gross: m.gross, ytd, params: m.params });
    if (!r.ok) return r;
    results.push(r.value);
    ytd = r.value.ytd;
  }
  return ok(results);
}
