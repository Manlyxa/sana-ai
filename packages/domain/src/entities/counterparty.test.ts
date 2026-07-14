import { describe, expect, it } from 'vitest';
import { createCounterparty, hasCriticalRiskFlag, RISK_FLAGS } from './counterparty';
import { testCounterparty } from '../testing/fixtures';
import { unwrap } from '../kernel/result';

describe('Counterparty', () => {
  it('создаёт чистого контрагента', () => {
    const cp = unwrap(createCounterparty(testCounterparty()));
    expect(cp.riskFlags).toEqual([]);
    expect(hasCriticalRiskFlag(cp)).toBe(false);
  });

  it('словарь флагов риска — по спецификации §4', () => {
    expect(RISK_FLAGS).toEqual([
      'LZHEPREDPRIYATIE',
      'E_TAMGA',
      'TAX_DEBT',
      'BANKRUPTCY',
      'OKED_MISMATCH',
      'INACTIVE',
    ]);
  });

  it('лжепредприятие / e-Tamga / банкротство — критические флаги', () => {
    for (const flag of ['LZHEPREDPRIYATIE', 'E_TAMGA', 'BANKRUPTCY'] as const) {
      const cp = unwrap(createCounterparty(testCounterparty({ riskFlags: [flag], riskScore: 90 })));
      expect(hasCriticalRiskFlag(cp)).toBe(true);
    }
    const cp = unwrap(createCounterparty(testCounterparty({ riskFlags: ['TAX_DEBT', 'INACTIVE'] })));
    expect(hasCriticalRiskFlag(cp)).toBe(false);
  });

  it('отвергает riskScore вне 0–100 и дубли флагов', () => {
    expect(createCounterparty(testCounterparty({ riskScore: 101 })).ok).toBe(false);
    expect(createCounterparty(testCounterparty({ riskScore: -1 })).ok).toBe(false);
    expect(createCounterparty(testCounterparty({ riskScore: 5.5 })).ok).toBe(false);
    expect(
      createCounterparty(testCounterparty({ riskFlags: ['TAX_DEBT', 'TAX_DEBT'] })).ok,
    ).toBe(false);
  });

  it('отвергает пустое наименование', () => {
    expect(createCounterparty(testCounterparty({ name: ' ' })).ok).toBe(false);
  });

  it('режим контрагента может быть неизвестен', () => {
    const cp = unwrap(createCounterparty(testCounterparty({ taxRegime: 'НЕИЗВЕСТНО' })));
    expect(cp.taxRegime).toBe('НЕИЗВЕСТНО');
  });
});
