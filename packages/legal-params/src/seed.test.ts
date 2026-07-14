import { describe, expect, it } from 'vitest';
import { LocalDate, Money, Rate, unwrap } from '@sana/domain';
import { createSeededStore, SEED_PARAMETERS } from './seed';
import { renderTodoVerifyReport } from './report';
import { P } from './keys';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const store = createSeededStore();

describe('seed: темпоральность (P2)', () => {
  it('ДОКАЗАТЕЛЬСТВО: vat.rate.standard на 2025-06-01 = 12%, на 2026-06-01 = 16%', () => {
    const in2025 = unwrap(store.resolve(P.VAT_RATE_STANDARD, D('2025-06-01')));
    const in2026 = unwrap(store.resolve(P.VAT_RATE_STANDARD, D('2026-06-01')));
    expect(in2025.value.equals(Rate.percent(12))).toBe(true);
    expect(in2026.value.equals(Rate.percent(16))).toBe(true);
    expect(in2025.version).toBe('vat.rate.standard@2009-01-01');
    expect(in2026.version).toBe('vat.rate.standard@2026-01-01');
  });

  it('МРП: 3 932 ₸ в 2025, 4 325 ₸ в 2026', () => {
    expect(unwrap(store.resolve(P.MRP, D('2025-06-01'))).value.equals(Money.ofMajor(3_932))).toBe(true);
    expect(unwrap(store.resolve(P.MRP, D('2026-06-01'))).value.equals(Money.ofMajor(4_325))).toBe(true);
  });

  it('порог регистрации по НДС: 10 000 МРП = 43 250 000 ₸ в 2026', () => {
    const asOf = D('2026-03-01');
    const mrp = unwrap(store.resolve(P.MRP, asOf)).value;
    const thresholdMrp = unwrap(store.resolve(P.VAT_REGISTRATION_THRESHOLD_MRP, asOf)).value;
    expect(mrp.multiply(thresholdMrp).equals(Money.ofMajor(43_250_000))).toBe(true);
  });
});

describe('seed: значения 2026 (§5)', () => {
  const asOf = D('2026-06-01');
  const resolve = <T>(key: import('./types').ParamKey<T>) => unwrap(store.resolve(key, asOf)).value;

  it('МЗП и ставки', () => {
    expect(resolve(P.MZP).equals(Money.ofMajor(85_000))).toBe(true);
    expect(resolve(P.VAT_RATE_REDUCED_MEDICAL).equals(Rate.percent(5))).toBe(true);
    expect(resolve(P.VAT_RATE_EXPORT).isZero()).toBe(true);
    expect(resolve(P.KPN_RATE_STANDARD).equals(Rate.percent(20))).toBe(true);
    expect(resolve(P.SNR_UPROSHCHENKA_RATE).equals(Rate.percent(4))).toBe(true);
    expect(resolve(P.SNR_UPROSHCHENKA_INCOME_LIMIT_MRP)).toBe(600_000);
  });

  it('ИПН: прогрессия и стандартный вычет', () => {
    expect(resolve(P.IPN_BRACKET1_RATE).equals(Rate.percent(10))).toBe(true);
    expect(resolve(P.IPN_BRACKET1_CEILING_MRP)).toBe(8_500);
    expect(resolve(P.IPN_BRACKET2_RATE).equals(Rate.percent(15))).toBe(true);
    expect(resolve(P.IPN_STANDARD_DEDUCTION)).toEqual({
      mrpPerMonth: 30,
      mrpAnnualMax: 360,
      requiresApplication: true,
    });
  });

  it('социальные платежи: ставки, базы, потолки', () => {
    const opv = resolve(P.OPV);
    expect(opv.rate.equals(Rate.percent(10))).toBe(true);
    expect(opv.capMzp).toBe(50);

    const opvr = resolve(P.OPVR);
    expect(opvr.rate.equals(Rate.percent('3.5'))).toBe(true);
    expect(opvr.capMzp).toBe(50);
    expect(opvr.exemptIfBornBefore.equals(D('1975-01-01'))).toBe(true);

    const so = resolve(P.SO);
    expect(so.rate.equals(Rate.percent(5))).toBe(true);
    expect(so.base).toBe('GROSS_MINUS_OPV');
    expect(so.floorMzp).toBe(1);
    expect(so.capMzp).toBe(7);

    expect(resolve(P.OOSMS)).toMatchObject({ capMzp: 40 });
    expect(resolve(P.OOSMS).rate.equals(Rate.percent(3))).toBe(true);
    expect(resolve(P.VOSMS)).toMatchObject({ capMzp: 20 });
    expect(resolve(P.VOSMS).rate.equals(Rate.percent(2))).toBe(true);

    const sn = resolve(P.SN);
    expect(sn.rate.equals(Rate.percent(6))).toBe(true);
    expect(sn.base).toBe('GROSS_MINUS_OPV_MINUS_VOSMS');
    expect(sn.soOffset).toBe(false);
  });

  it('сроки ЭСФ и регистрации по НДС', () => {
    expect(resolve(P.ESF_ISSUE_DEADLINE)).toEqual({ days: 15, kind: 'CALENDAR' });
    expect(resolve(P.ESF_NONRESIDENT_DEADLINE)).toEqual({ days: 5, kind: 'CALENDAR' });
    expect(resolve(P.VAT_REGISTRATION_APPLICATION_DAYS)).toEqual({ days: 5, kind: 'WORKING' });
  });

  it('сроки ФНО и уплаты', () => {
    expect(resolve(P.FNO_300_FILING_WINDOW)).toEqual({
      opens: { monthsAfterPeriodEnd: 1, dayOfMonth: 15 },
      closes: { monthsAfterPeriodEnd: 2, dayOfMonth: 15 },
    });
    expect(resolve(P.FNO_300_PAYMENT_DUE)).toEqual({ monthsAfterPeriodEnd: 2, dayOfMonth: 25 });
    expect(resolve(P.FNO_200_FILING_DUE)).toEqual({ monthsAfterPeriodEnd: 2, dayOfMonth: 15 });
    expect(resolve(P.FNO_100_FILING_DUE)).toEqual({ monthsAfterPeriodEnd: 3, dayOfMonth: 31 });
    expect(resolve(P.FNO_910_FILING_DUE)).toEqual({ monthsAfterPeriodEnd: 2, dayOfMonth: 15 });
    expect(resolve(P.PAYROLL_TAXES_PAYMENT_DUE)).toEqual({ monthsAfterPeriodEnd: 1, dayOfMonth: 25 });
  });
});

describe('seed: гигиена данных (P2, P3, §10)', () => {
  it('каждый параметр несёт норму и источник', () => {
    for (const p of SEED_PARAMETERS) {
      expect(p.norm.trim(), p.key).not.toBe('');
      expect(p.source.trim(), p.key).not.toBe('');
    }
  });

  it('все значения 2026 года действуют с 2026-01-01', () => {
    const from2026 = SEED_PARAMETERS.filter((p) => !p.validFrom.isBefore(D('2026-01-01')));
    for (const p of from2026) {
      expect(p.validFrom.toISO(), p.key).toBe('2026-01-01');
    }
    expect(from2026.length).toBeGreaterThanOrEqual(25);
  });

  it('все пункты §10 закодированы и помечены TODO_VERIFY', () => {
    const flagged = store.todoVerify().map((p) => p.key);
    expect(flagged).toEqual([
      'audit.mandatory.thresholds',
      'cash.settlement.limit.mrp',
      'esutd.registration.deadline',
      'ipn.dividends',
      'kpn.depreciation.norms',
      'kpn.loss.carryforward.years',
      'snr.supplier.deduction.ban',
      'unified.payment.rate',
    ]);
  });

  it('отчёт TODO_VERIFY перечисляет каждый непроверенный параметр', () => {
    const report = renderTodoVerifyReport(store);
    for (const p of store.todoVerify()) {
      expect(report).toContain(p.key);
    }
    expect(report).toContain('Всего: 8.');
  });
});
