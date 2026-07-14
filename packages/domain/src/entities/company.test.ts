import { describe, expect, it } from 'vitest';
import { createCompany } from './company';
import { testCompany } from '../testing/fixtures';
import { unwrap } from '../kernel/result';

describe('Company', () => {
  it('создаёт валидное ТОО на ОУР с НДС', () => {
    const company = unwrap(createCompany(testCompany()));
    expect(company.taxRegime).toBe('ОУР');
    expect(company.vatStatus.registered).toBe(true);
    expect(company.reportingStandard).toBe('НСФО');
    expect(company.employeeCount).toBe(12);
  });

  it('копирует массив ОКЭД (иммутабельность)', () => {
    const input = testCompany();
    const company = unwrap(createCompany(input));
    expect(company.oked).toEqual(input.oked);
    expect(company.oked).not.toBe(input.oked);
  });

  it('отвергает пустые id/наименование', () => {
    const r = createCompany(testCompany({ id: ' ', name: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((e) => e.field).sort()).toEqual(['id', 'name']);
  });

  it('отвергает пустой и невалидный ОКЭД', () => {
    expect(createCompany(testCompany({ oked: [] })).ok).toBe(false);
    expect(createCompany(testCompany({ oked: ['6201'] })).ok).toBe(false);
    expect(createCompany(testCompany({ oked: ['62010', 'abcde'] })).ok).toBe(false);
  });

  it('отвергает отрицательное/нецелое число работников', () => {
    expect(createCompany(testCompany({ employeeCount: -1 })).ok).toBe(false);
    expect(createCompany(testCompany({ employeeCount: 1.5 })).ok).toBe(false);
    expect(createCompany(testCompany({ employeeCount: 0 })).ok).toBe(true);
  });
});
