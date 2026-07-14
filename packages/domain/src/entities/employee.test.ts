import { describe, expect, it } from 'vitest';
import { createEmployee, isActiveOn } from './employee';
import { D, testEmployee, TEST_IIN_1970 } from '../testing/fixtures';
import { unwrap } from '../kernel/result';

describe('Employee', () => {
  it('создаёт работника; дата рождения согласована с ИИН', () => {
    const e = unwrap(createEmployee(testEmployee()));
    expect(e.birthDate.toISO()).toBe('1990-05-15');
    expect(e.ipnDeductionApplicationAt).not.toBeNull();
  });

  it('отвергает дату рождения, не совпадающую с закодированной в ИИН', () => {
    const r = createEmployee(testEmployee({ birthDate: D('1991-01-01') }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.field).toBe('birthDate');
  });

  it('работник 1970 года рождения (для освобождения от ОПВР)', () => {
    const e = unwrap(
      createEmployee(testEmployee({ iin: TEST_IIN_1970, birthDate: D('1970-03-01') })),
    );
    expect(e.birthDate.isBefore(D('1975-01-01'))).toBe(true);
  });

  it('отвергает увольнение раньше приёма и пустое ФИО', () => {
    expect(
      createEmployee(testEmployee({ terminatedAt: D('2024-01-31') })).ok,
    ).toBe(false);
    expect(createEmployee(testEmployee({ fullName: '' })).ok).toBe(false);
  });

  it('isActiveOn учитывает приём и увольнение включительно', () => {
    const active = unwrap(createEmployee(testEmployee()));
    expect(isActiveOn(active, D('2024-01-31'))).toBe(false);
    expect(isActiveOn(active, D('2024-02-01'))).toBe(true);

    const gone = unwrap(createEmployee(testEmployee({ terminatedAt: D('2026-03-31') })));
    expect(isActiveOn(gone, D('2026-03-31'))).toBe(true);
    expect(isActiveOn(gone, D('2026-04-01'))).toBe(false);
  });

  it('статусные поля: пенсионер, инвалидность, студент', () => {
    const e = unwrap(
      createEmployee(
        testEmployee({
          pensionerByAge: true,
          disability: { group: 'II', indefinite: true },
          fullTimeStudent: false,
          ipnDeductionApplicationAt: null,
        }),
      ),
    );
    expect(e.pensionerByAge).toBe(true);
    expect(e.disability?.group).toBe('II');
    expect(e.ipnDeductionApplicationAt).toBeNull();
  });
});
