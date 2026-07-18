import { describe, expect, it } from 'vitest';
import {
  Bin,
  createEmployee,
  createLedgerEntry,
  Iin,
  LocalDate,
  Money,
  TaxPeriod,
  unwrap,
  type Employee,
} from '@sana/domain';
import { buildPayrollLawParams, createSeededStore } from '@sana/legal-params';
import { FixtureEnbekAdapter, FixturePayrollAdapter } from '@sana/adapters';
import { loadPayrollRecords, type PayrollEmployeeRecord } from './load-payroll';
import { PayrollRun } from './payroll-run';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const COMPANY_BIN = unwrap(Bin.parse('120540000001'));
const JULY = TaxPeriod.month(2026, 7);
const params = unwrap(buildPayrollLawParams(createSeededStore(), D('2026-07-31')));

function employee(iin: string, name: string): Employee {
  const parsed = unwrap(Iin.parse(iin));
  return unwrap(
    createEmployee({
      iin: parsed,
      fullName: name,
      birthDate: parsed.birthDate!,
      hiredAt: D('2020-01-01'),
      terminatedAt: null,
      residency: 'РЕЗИДЕНТ_РК',
      pensionerByAge: false,
      disability: null,
      fullTimeStudent: false,
      ipnDeductionApplicationAt: null,
      esutdRegisteredAt: D('2020-01-02'),
    }),
  );
}

function record(
  emp: Employee,
  grossTengeByMonth: Record<number, number>,
): PayrollEmployeeRecord {
  const grossByMonth = new Map<number, Money>();
  for (const [m, tenge] of Object.entries(grossTengeByMonth)) {
    grossByMonth.set(Number(m), Money.ofMajor(tenge));
  }
  return { employee: emp, position: 'Специалист', grossByMonth };
}

async function fixtureRun(): Promise<PayrollRun> {
  const records = unwrap(
    await loadPayrollRecords(
      { enbek: new FixtureEnbekAdapter(), payroll: new FixturePayrollAdapter() },
      COMPANY_BIN,
      2026,
    ),
  );
  return unwrap(PayrollRun.create({ companyId: 'demo-too', month: JULY, records, params }));
}

describe('loadPayrollRecords', () => {
  it('соединяет ведомость с договорами ЕСУТД по ИИН', async () => {
    const records = unwrap(
      await loadPayrollRecords(
        { enbek: new FixtureEnbekAdapter(), payroll: new FixturePayrollAdapter() },
        COMPANY_BIN,
        2026,
      ),
    );
    expect(records).toHaveLength(7);
    const accountant = records.find((r) => r.position === 'Бухгалтер');
    expect(accountant?.employee.fullName).toBe('Сулейменова Айгерим Нурлановна');
    expect(accountant?.employee.ipnDeductionApplicationAt?.toISO()).toBe('2026-01-05');
  });

  it('ведомость за отсутствующий год — ошибка, а не пустой список', async () => {
    const result = await loadPayrollRecords(
      { enbek: new FixtureEnbekAdapter(), payroll: new FixturePayrollAdapter() },
      COMPANY_BIN,
      2031,
    );
    expect(result.ok).toBe(false);
  });
});

describe('PayrollRun — ведомость июля из фикстур', () => {
  it('каждая строка расшифрована движком: ОПВ 10%, ВОСМС 2%, ИПН от базы', async () => {
    const run = await fixtureRun();
    expect(run.lines()).toHaveLength(7);

    // Кладовщик, 180 000 ₸, без заявления на вычет.
    const line = run.line('700301300002')!;
    expect(line.result.gross.toDecimalString()).toBe('180000.00');
    expect(line.result.opv.toDecimalString()).toBe('18000.00');
    expect(line.result.vosms.toDecimalString()).toBe('3600.00');
    // База = 180 000 − 18 000 − 3 600 = 158 400; ИПН 10%.
    expect(line.result.ipn.toDecimalString()).toBe('15840.00');
    expect(line.result.net.toDecimalString()).toBe('142560.00');
    // Родился в 1970 → ОПВР не платится (Соц. кодекс).
    expect(line.result.employer.opvr.isZero()).toBe(true);
    expect(line.result.paramsVersion).toContain('legal-params@');
  });

  it('заявление на вычет 30 МРП уменьшает ИПН (бухгалтер)', async () => {
    const run = await fixtureRun();
    const line = run.line('921103400000')!;
    // База 250 000 − 25 000 − 5 000 = 220 000; вычет 30×4325 = 129 750 → 90 250 × 10%.
    expect(line.result.ipn.toDecimalString()).toBe('9025.00');
  });

  it('нарастающий итог: доход с начала года виден в prevYtd', async () => {
    const run = await fixtureRun();
    // Продавец с повышением: янв–мар 150 000, апр–июн 200 000.
    const raised = run.line('950128300003')!;
    // Продавец с постоянным окладом 200 000.
    const steady = run.line('880917400003')!;
    expect(raised.result.gross.equals(steady.result.gross)).toBe(true);
    expect(raised.prevYtd.cumTaxableIncome.compareTo(steady.prevYtd.cumTaxableIncome)).toBeLessThan(0);
  });
});

describe('ИПН нарастающим итогом — одинаковый оклад, разный доход с начала года', () => {
  it('сотрудник, пересёкший потолок 8500 МРП, платит больший ИПН при том же окладе месяца', () => {
    // A работает с января по 6 000 000 ₸/мес: к июлю накопленная база
    // пересекает 8500 МРП × 4325 = 36 762 500 ₸ → часть июля по 15%.
    const a = employee('900515300008', 'Высокий доход с января');
    // B получает те же 6 000 000 ₸ в июле, но начал в июле: вся база по 10%.
    const b = employee('921103400000', 'Тот же оклад, нанят в июле');
    const run = unwrap(
      PayrollRun.create({
        companyId: 'demo-too',
        month: JULY,
        records: [
          record(a, { 1: 6_000_000, 2: 6_000_000, 3: 6_000_000, 4: 6_000_000, 5: 6_000_000, 6: 6_000_000, 7: 6_000_000 }),
          record(b, { 7: 6_000_000 }),
        ],
        params,
      }),
    );
    const lineA = run.line('900515300008')!;
    const lineB = run.line('921103400000')!;

    expect(lineA.result.gross.equals(lineB.result.gross)).toBe(true);
    // Месячная база: 6 000 000 − 425 000 (ОПВ, потолок 50 МЗП) − 34 000
    // (ВОСМС, потолок 20 МЗП) = 5 541 000.
    // B: весь июль по 10% → 554 100.
    expect(lineB.result.ipn.toDecimalString()).toBe('554100.00');
    // A: накоплено к июлю 6 × 5 541 000 = 33 246 000; потолок 8500 МРП = 36 762 500.
    // До потолка 10% (3 516 500 → 351 650), сверх 15% (2 024 500 → 303 675) = 655 325.
    expect(lineA.result.ipn.toDecimalString()).toBe('655325.00');
    expect(lineA.result.ipn.compareTo(lineB.result.ipn)).toBeGreaterThan(0);
  });
});

describe('подтверждение и начисление', () => {
  it('«Подтвердить расчёт» меняет статус; повторное подтверждение — ошибка', async () => {
    const run = await fixtureRun();
    const before = run.line('850214300001')!;
    expect(before.status).toBe('PENDING');

    const confirmed = unwrap(run.confirm('850214300001', { confirmedBy: 'Айгерим', at: D('2026-07-25') }));
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmation?.by).toBe('Айгерим');
    expect(run.summary().confirmed).toBe(1);

    const again = run.confirm('850214300001', { confirmedBy: 'Айгерим', at: D('2026-07-25') });
    expect(again.ok).toBe(false);
  });

  it('начисление невозможно, пока есть неподтверждённые строки', async () => {
    const run = await fixtureRun();
    const blocked = run.accrualEntryInput({ date: D('2026-07-31') });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.message).toContain('не подтверждены');
  });

  it('после подтверждения всех строк начисление — одна сбалансированная проводка', async () => {
    const run = await fixtureRun();
    expect(run.confirmAll({ confirmedBy: 'Айгерим', at: D('2026-07-25') })).toBe(7);

    const input = unwrap(run.accrualEntryInput({ date: D('2026-07-31') }));
    // Реестр принимает проводку — значит Дт = Кт и все счета известны.
    const entry = unwrap(createLedgerEntry(input));
    expect(entry.period.code()).toBe('2026-M07');
    expect(entry.norm).toContain('НК РК');

    const s = run.summary();
    const debit = input.lines
      .filter((l) => l.side === 'DEBIT')
      .reduce((sum, l) => sum.add(l.amount), Money.zero());
    expect(debit.equals(s.totalGross.add(s.totalEmployerCost))).toBe(true);
  });

  it('сводка: удержания = ИПН + ОПВ + ВОСМС, на руки = начислено − удержания', async () => {
    const run = await fixtureRun();
    const s = run.summary();
    expect(s.employees).toBe(7);
    expect(s.totalGross.toDecimalString()).toBe('1645000.00');
    expect(s.totalGross.subtract(s.totalWithheld).equals(s.totalNet)).toBe(true);
  });
});
