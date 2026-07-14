import { describe, expect, it } from 'vitest';
import { LocalDate, Money, Rate, unwrap, computePayrollMonth, emptyYtd } from '@sana/domain';
import { createSeededStore } from './seed';
import { buildPayrollLawParams, buildRuleLawParams } from './build';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const store = createSeededStore();

describe('buildPayrollLawParams', () => {
  it('собирает снимок 2026 и версию для Justification', () => {
    const p = unwrap(buildPayrollLawParams(store, D('2026-03-01')));
    expect(p.version).toBe('legal-params@2026-03-01');
    expect(p.mrp.equals(Money.ofMajor(4_325))).toBe(true);
    expect(p.opv.rate.equals(Rate.percent(10))).toBe(true);
    expect(p.ipn.bracket1CeilingMrp).toBe(8_500);
    expect(p.ipn.additionalDeductionDisabilityMrpAnnual).toBe(882);
    expect(p.opvr.exemptIfBornBefore.toISO()).toBe('1975-01-01');
  });

  it('снимок работает в зарплатном движке end-to-end', () => {
    const params = unwrap(buildPayrollLawParams(store, D('2026-03-01')));
    const employee = {
      iin: undefined as never, // движок не читает ИИН — только статусные поля
      fullName: 'Тест',
      birthDate: D('1990-05-15'),
      hiredAt: D('2024-02-01'),
      terminatedAt: null,
      residency: 'РЕЗИДЕНТ_РК' as const,
      pensionerByAge: false,
      disability: null,
      fullTimeStudent: false,
      ipnDeductionApplicationAt: D('2024-02-01'),
      esutdRegisteredAt: D('2024-02-01'),
    };
    const r = unwrap(
      computePayrollMonth({ employee, gross: Money.ofMajor(200_000), ytd: emptyYtd(), params }),
    );
    expect(r.ipn.equals(Money.ofMajor(4_625))).toBe(true);
  });

  it('ошибка разрешения (дата вне действия параметров) → Err', () => {
    const r = buildPayrollLawParams(store, D('2020-01-01'));
    expect(r.ok).toBe(false);
  });
});

describe('buildRuleLawParams', () => {
  it('собирает снимок для движка правил, включая штрафы и праздники', () => {
    const p = unwrap(buildRuleLawParams(store, D('2026-03-01')));
    expect(p.vatRegistrationThresholdMrp).toBe(10_000);
    expect(p.esfIssueDeadlineCalendarDays).toBe(15);
    expect(p.fno300Closes).toEqual({ monthsAfterPeriodEnd: 2, dayOfMonth: 15 });
    expect(p.fineVatRegistrationMrp).toBe(50);
    expect(p.noticeResponseWorkingDays).toBe(30);
    expect(p.holidays.has('2026-03-22')).toBe(true); // Наурыз
    expect(p.kpnRate.equals(Rate.percent(20))).toBe(true);
  });
});
