import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computePayrollMonth, computePayrollSequence } from './engine';
import { emptyYtd, type PayrollLawParams } from './params';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { D, payrollParams2026, testEmployee, TEST_IIN_1970 } from '../testing/fixtures';
import type { Employee } from '../entities/employee';

/**
 * §6 спецификации: тесты написаны ДО реализации и являются её спецификацией.
 * 2026: МРП 4 325 ₸, МЗП 85 000 ₸, стандартный вычет 30 МРП = 129 750 ₸,
 * потолок 1-й ступени ИПН 8 500 МРП = 36 762 500 ₸ (накопительно за год).
 */

const P: PayrollLawParams = payrollParams2026();
const T = (tenge: number) => Money.ofMajor(tenge);

function month(employee: Employee, grossTenge: number, ytd = emptyYtd()) {
  return unwrap(computePayrollMonth({ employee, gross: T(grossTenge), ytd, params: P }));
}

describe('§6.1: gross = 1 МЗП, заявление на вычет есть → ИПН = 0', () => {
  it('вычет превышает базу', () => {
    const r = month(testEmployee(), 85_000);
    expect(r.opv.equals(T(8_500))).toBe(true);
    expect(r.vosms.equals(T(1_700))).toBe(true);
    // база 74 800 < вычет 129 750 → облагаемый доход 0
    expect(r.taxableIncome.isZero()).toBe(true);
    expect(r.ipn.isZero()).toBe(true);
    expect(r.net.equals(T(74_800))).toBe(true);
  });
});

describe('§6.2: gross = 200 000 ₸, заявление есть', () => {
  const r = month(testEmployee(), 200_000);

  it('работник: ОПВ 20 000, ВОСМС 4 000, ИПН 4 625, на руки 171 375', () => {
    expect(r.opv.equals(T(20_000))).toBe(true);
    expect(r.vosms.equals(T(4_000))).toBe(true);
    expect(r.standardDeduction.equals(T(129_750))).toBe(true);
    expect(r.taxableIncome.equals(T(46_250))).toBe(true);
    expect(r.ipn.equals(T(4_625))).toBe(true);
    expect(r.net.equals(T(171_375))).toBe(true);
  });

  it('работодатель: ОПВР 7 000, СО 9 000, ООСМС 6 000, СН 10 560', () => {
    expect(r.employer.opvr.equals(T(7_000))).toBe(true);
    expect(r.employer.so.equals(T(9_000))).toBe(true); // 5% × (200 000 − 20 000)
    expect(r.employer.oosms.equals(T(6_000))).toBe(true);
    expect(r.employer.sn.equals(T(10_560))).toBe(true); // 6% × 176 000, без зачёта СО
  });
});

describe('§6.3: gross = 200 000 ₸, заявления НЕТ → вычет не применяется', () => {
  it('ИПН 17 600 вместо 4 625', () => {
    const r = month(testEmployee({ ipnDeductionApplicationAt: null }), 200_000);
    expect(r.standardDeduction.isZero()).toBe(true);
    expect(r.taxableIncome.equals(T(176_000))).toBe(true);
    expect(r.ipn.equals(T(17_600))).toBe(true);
  });
});

describe('§6.4: работник 1970 г.р. → ОПВР = 0', () => {
  it('освобождение по дате рождения (Соц. кодекс)', () => {
    const r = month(
      testEmployee({ iin: TEST_IIN_1970, birthDate: D('1970-03-01') }),
      200_000,
    );
    expect(r.employer.opvr.isZero()).toBe(true);
    expect(r.opv.equals(T(20_000))).toBe(true); // сам ОПВ платит
  });
});

describe('§6.5: пересечение потолка 8 500 МРП внутри года', () => {
  // Без заявления: облагаемый доход = 7 000 000 − ОПВ 425 000 − ВОСМС 34 000
  // = 6 541 000/мес. Потолок 36 762 500 пересекается в 6-м месяце.
  const employee = testEmployee({ ipnDeductionApplicationAt: null });
  const months = Array.from({ length: 7 }, () => ({ gross: T(7_000_000), params: P }));
  const results = unwrap(computePayrollSequence(employee, months));

  it('месяцы 1–5 — целиком по 10%', () => {
    for (let i = 0; i < 5; i++) {
      expect(results[i]?.ipn.equals(T(654_100)), `месяц ${i + 1}`).toBe(true);
    }
  });

  it('переход 10% → 15% происходит В МЕСЯЦЕ пересечения (6-й), а не в следующем', () => {
    // cum 6 мес = 39 246 000: 36 762 500 × 10% + 2 483 500 × 15% = 4 048 775
    // минус уплачено за 5 мес (3 270 500) = 778 275
    expect(results[5]?.ipn.equals(T(778_275))).toBe(true);
  });

  it('месяц 7 — целиком по 15%', () => {
    expect(results[6]?.ipn.equals(T(981_150))).toBe(true);
  });
});

describe('§6.6: gross = 6 000 000 ₸ — все потолки связывают одновременно', () => {
  const r = month(testEmployee({ ipnDeductionApplicationAt: null }), 6_000_000);

  it('ОПВ по 50 МЗП, ВОСМС по 20 МЗП, ООСМС по 40 МЗП, СО по 7 МЗП', () => {
    expect(r.opv.equals(T(425_000))).toBe(true); // 10% × 4 250 000
    expect(r.vosms.equals(T(34_000))).toBe(true); // 2% × 1 700 000
    expect(r.employer.oosms.equals(T(102_000))).toBe(true); // 3% × 3 400 000
    expect(r.employer.so.equals(T(29_750))).toBe(true); // 5% × 595 000
    expect(r.employer.opvr.equals(T(148_750))).toBe(true); // 3.5% × 4 250 000
    expect(r.employer.sn.equals(T(332_460))).toBe(true); // 6% × 5 541 000
  });
});

describe('§6.7: ретроактивная корректировка 3-го месяца в 9-м', () => {
  const employee = testEmployee({ ipnDeductionApplicationAt: null });
  const original = Array.from({ length: 9 }, () => ({ gross: T(300_000), params: P }));
  const corrected = original.map((m, i) => (i === 2 ? { ...m, gross: T(500_000) } : m));

  it('пересборка с месяца 1 корректно распространяет накопительный итог', () => {
    const before = unwrap(computePayrollSequence(employee, original));
    const after = unwrap(computePayrollSequence(employee, corrected));
    // месяцы 1–2 не изменились
    expect(after[0]?.ipn.equals(before[0]?.ipn as Money)).toBe(true);
    expect(after[1]?.ipn.equals(before[1]?.ipn as Money)).toBe(true);
    // месяц 3 — больше доход, больше ИПН
    expect(after[2]?.ipn.compareTo(before[2]?.ipn as Money)).toBeGreaterThan(0);
    // инвариант: Σ ИПН = ИПН от суммарного облагаемого дохода
    const last = after[8];
    const sum = after.reduce((acc, m) => acc.add(m.ipn), Money.zero());
    expect(sum.equals(last?.ytd.cumIpn as Money)).toBe(true);
  });
});

describe('§6.8: категории работников', () => {
  it('пенсионер: ОПВ/ВОСМС/СО/ООСМС/ОПВР = 0; СН с полного дохода', () => {
    const r = month(testEmployee({ pensionerByAge: true }), 200_000);
    expect(r.opv.isZero()).toBe(true);
    expect(r.vosms.isZero()).toBe(true);
    expect(r.employer.so.isZero()).toBe(true);
    expect(r.employer.oosms.isZero()).toBe(true);
    expect(r.employer.opvr.isZero()).toBe(true);
    expect(r.taxableIncome.equals(T(70_250))).toBe(true); // 200 000 − 129 750
    expect(r.ipn.equals(T(7_025))).toBe(true);
    expect(r.employer.sn.equals(T(12_000))).toBe(true); // база не уменьшена
  });

  it('инвалид II группы (бессрочно): ОПВ 0, ВОСМС 0, вычет 882 МРП гасит ИПН', () => {
    const r = month(
      testEmployee({ disability: { group: 'II', indefinite: true } }),
      200_000,
    );
    expect(r.opv.isZero()).toBe(true);
    expect(r.vosms.isZero()).toBe(true);
    expect(r.additionalDeduction.equals(T(70_250))).toBe(true); // остаток базы
    expect(r.taxableIncome.isZero()).toBe(true);
    expect(r.ipn.isZero()).toBe(true);
    expect(r.employer.opvr.equals(T(7_000))).toBe(true); // 1990 г.р. — ОПВР платится
    expect(r.employer.oosms.isZero()).toBe(true);
  });

  it('инвалид III группы: ОПВ платится, ВОСМС нет, вычет 882 МРП применяется', () => {
    const r = month(
      testEmployee({ disability: { group: 'III', indefinite: false } }),
      200_000,
    );
    expect(r.opv.equals(T(20_000))).toBe(true);
    expect(r.vosms.isZero()).toBe(true);
    expect(r.taxableIncome.isZero()).toBe(true); // 50 250 погашено доп. вычетом
  });

  it('нерезидент (ИНОСТРАНЕЦ): без соцплатежей, ИПН без вычетов', () => {
    const r = month(testEmployee({ residency: 'ИНОСТРАНЕЦ' }), 200_000);
    expect(r.opv.isZero()).toBe(true);
    expect(r.vosms.isZero()).toBe(true);
    expect(r.standardDeduction.isZero()).toBe(true);
    expect(r.taxableIncome.equals(T(200_000))).toBe(true);
    expect(r.ipn.equals(T(20_000))).toBe(true);
    expect(r.employer.opvr.isZero()).toBe(true);
    expect(r.employer.so.isZero()).toBe(true);
    expect(r.employer.oosms.isZero()).toBe(true);
    expect(r.employer.sn.equals(T(12_000))).toBe(true);
  });

  it('гражданин ЕАЭС: приравнен к резиденту', () => {
    const eaes = month(testEmployee({ residency: 'ЕАЭС' }), 200_000);
    const resident = month(testEmployee(), 200_000);
    expect(eaes.ipn.equals(resident.ipn)).toBe(true);
    expect(eaes.opv.equals(resident.opv)).toBe(true);
    expect(eaes.employer.sn.equals(resident.employer.sn)).toBe(true);
  });
});

describe('§6.9: свойство — Σ месячных ИПН = ИПН от годового итога', () => {
  it('для любой случайной 12-месячной последовательности доходов', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 12, maxLength: 12 }),
        fc.boolean(),
        (grossMonths, hasApplication) => {
          const employee = testEmployee(
            hasApplication ? {} : { ipnDeductionApplicationAt: null },
          );
          const results = unwrap(
            computePayrollSequence(
              employee,
              grossMonths.map((g) => ({ gross: T(g), params: P })),
            ),
          );
          const sum = results.reduce((acc, m) => acc.add(m.ipn), Money.zero());
          const finalYtd = results[11]?.ytd;
          // телескопическая сумма месячных ИПН обязана дать накопительный ИПН года
          expect(sum.equals(finalYtd?.cumIpn as Money)).toBe(true);
          // и накопительный ИПН обязан равняться прямому расчёту от годовой базы
          const ceiling = P.mrp.multiply(P.ipn.bracket1CeilingMrp);
          const cumTaxable = finalYtd?.cumTaxableIncome as Money;
          const below = Money.min(cumTaxable, ceiling);
          const above = Money.max(cumTaxable.subtract(ceiling), Money.zero());
          const direct = below
            .percent(P.ipn.bracket1Rate)
            .roundToMajor()
            .add(above.percent(P.ipn.bracket2Rate).roundToMajor());
          expect(sum.equals(direct)).toBe(true);
        },
      ),
    );
  });
});

describe('граничные случаи', () => {
  it('нулевой доход месяца → нулевые платежи (в т.ч. без минимума СО)', () => {
    const r = month(testEmployee(), 0);
    expect(r.opv.isZero()).toBe(true);
    expect(r.ipn.isZero()).toBe(true);
    expect(r.employer.so.isZero()).toBe(true);
    expect(r.employer.sn.isZero()).toBe(true);
  });

  it('СО: нижняя граница 1 МЗП при малой базе', () => {
    // gross 50 000: база СО = 45 000 < 1 МЗП → СО = 5% × 85 000 = 4 250
    const r = month(testEmployee(), 50_000);
    expect(r.employer.so.equals(T(4_250))).toBe(true);
  });

  it('отрицательный доход отвергается', () => {
    const r = computePayrollMonth({
      employee: testEmployee(),
      gross: T(-1),
      ytd: emptyYtd(),
      params: P,
    });
    expect(r.ok).toBe(false);
  });

  it('последовательность длиннее 12 месяцев отвергается', () => {
    const r = computePayrollSequence(
      testEmployee(),
      Array.from({ length: 13 }, () => ({ gross: T(1), params: P })),
    );
    expect(r.ok).toBe(false);
  });
});
