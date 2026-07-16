import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LocalDate, addWorkingDays, daysBetween, daysInMonth, isLeapYear } from './local-date';

describe('LocalDate', () => {
  it('of создаёт валидные даты и бросает на невалидных', () => {
    expect(LocalDate.of(2026, 2, 28).toISO()).toBe('2026-02-28');
    expect(LocalDate.of(2024, 2, 29).toISO()).toBe('2024-02-29'); // високосный
    expect(() => LocalDate.of(2026, 2, 29)).toThrow(RangeError);
    expect(() => LocalDate.of(2026, 13, 1)).toThrow(RangeError);
    expect(() => LocalDate.of(2026, 0, 1)).toThrow(RangeError);
    expect(() => LocalDate.of(2026.5, 1, 1)).toThrow(RangeError);
  });

  it('parse: ISO-строки с границ системы', () => {
    expect(LocalDate.parse('2026-01-15')).toEqual({ ok: true, value: LocalDate.of(2026, 1, 15) });
    expect(LocalDate.parse('2026-1-15').ok).toBe(false);
    expect(LocalDate.parse('2026-02-30').ok).toBe(false);
    expect(LocalDate.parse('garbage').ok).toBe(false);
  });

  it('високосные годы', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(() => daysInMonth(2025, 13)).toThrow(RangeError);
  });

  it('эпоха: 1970-01-01 = день 0', () => {
    expect(LocalDate.of(1970, 1, 1).toEpochDay()).toBe(0);
    expect(LocalDate.fromEpochDay(0).toISO()).toBe('1970-01-01');
  });

  it('plusDays / minusDays через границы месяцев и лет', () => {
    expect(LocalDate.of(2026, 12, 31).plusDays(1).toISO()).toBe('2027-01-01');
    expect(LocalDate.of(2026, 3, 1).minusDays(1).toISO()).toBe('2026-02-28');
    expect(LocalDate.of(2024, 3, 1).minusDays(1).toISO()).toBe('2024-02-29');
    // срок выставления ЭСФ: 15 календарных дней от даты оборота
    expect(LocalDate.of(2026, 1, 31).plusDays(15).toISO()).toBe('2026-02-15');
    expect(() => LocalDate.of(2026, 1, 1).plusDays(1.5)).toThrow(RangeError);
  });

  it('plusMonths прижимает день к концу месяца', () => {
    expect(LocalDate.of(2026, 1, 31).plusMonths(1).toISO()).toBe('2026-02-28');
    expect(LocalDate.of(2026, 1, 31).plusMonths(3).toISO()).toBe('2026-04-30');
    expect(LocalDate.of(2026, 11, 30).plusMonths(2).toISO()).toBe('2027-01-30');
    expect(LocalDate.of(2026, 5, 15).plusMonths(-5).toISO()).toBe('2025-12-15');
    expect(LocalDate.of(2024, 2, 29).plusYears(1).toISO()).toBe('2025-02-28');
    expect(() => LocalDate.of(2026, 1, 1).plusMonths(0.5)).toThrow(RangeError);
  });

  it('сравнения и isWithin (включая открытый интервал)', () => {
    const a = LocalDate.of(2026, 1, 1);
    const b = LocalDate.of(2026, 6, 1);
    expect(a.isBefore(b)).toBe(true);
    expect(b.isAfter(a)).toBe(true);
    expect(a.equals(LocalDate.of(2026, 1, 1))).toBe(true);
    expect(b.isWithin(a, null)).toBe(true);
    expect(b.isWithin(a, LocalDate.of(2026, 5, 31))).toBe(false);
    expect(b.isWithin(a, b)).toBe(true);
  });

  it('дни недели: 2026-01-01 — четверг', () => {
    expect(LocalDate.of(2026, 1, 1).dayOfWeek()).toBe(4);
    expect(LocalDate.of(2026, 1, 3).isWeekend()).toBe(true); // суббота
    expect(LocalDate.of(2026, 1, 4).isWeekend()).toBe(true); // воскресенье
    expect(LocalDate.of(2026, 1, 5).dayOfWeek()).toBe(1); // понедельник
  });

  it('startOfMonth / endOfMonth', () => {
    expect(LocalDate.of(2026, 2, 15).startOfMonth().toISO()).toBe('2026-02-01');
    expect(LocalDate.of(2026, 2, 15).endOfMonth().toISO()).toBe('2026-02-28');
    expect(LocalDate.of(2024, 2, 1).endOfMonth().toISO()).toBe('2024-02-29');
  });

  it('daysBetween', () => {
    expect(daysBetween(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 16))).toBe(15);
    expect(daysBetween(LocalDate.of(2026, 1, 16), LocalDate.of(2026, 1, 1))).toBe(-15);
  });

  it('addWorkingDays пропускает выходные и праздники', () => {
    // пятница 2026-01-09 + 5 рабочих дней = пятница 2026-01-16
    expect(addWorkingDays(LocalDate.of(2026, 1, 9), 5).toISO()).toBe('2026-01-16');
    expect(addWorkingDays(LocalDate.of(2026, 1, 9), 0).toISO()).toBe('2026-01-09');
    // с праздником в понедельник 12-го срок сдвигается на день
    const holidays = new Set(['2026-01-12']);
    expect(addWorkingDays(LocalDate.of(2026, 1, 9), 5, holidays).toISO()).toBe('2026-01-19');
    expect(() => addWorkingDays(LocalDate.of(2026, 1, 9), -1)).toThrow(RangeError);
  });

  it('toJSON — ISO-строка', () => {
    expect(JSON.stringify(LocalDate.of(2026, 3, 5))).toBe('"2026-03-05"');
  });

  it('свойство: toEpochDay/fromEpochDay — взаимно обратны', () => {
    fc.assert(
      fc.property(fc.integer({ min: -200_000, max: 200_000 }), (epochDay) => {
        const d = LocalDate.fromEpochDay(epochDay);
        expect(d.toEpochDay()).toBe(epochDay);
        expect(LocalDate.of(d.year, d.month, d.day).equals(d)).toBe(true);
      }),
    );
  });

  it('свойство: plusDays согласован с daysBetween', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: -5000, max: 5000 }),
        (epochDay, delta) => {
          const d = LocalDate.fromEpochDay(epochDay);
          expect(daysBetween(d, d.plusDays(delta))).toBe(delta);
        },
      ),
    );
  });
});
