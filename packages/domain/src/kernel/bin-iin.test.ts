import { describe, expect, it } from 'vitest';
import { Bin, Iin, computeCheckDigit } from './bin-iin';
import { unwrap } from './result';
import { LocalDate } from './local-date';

// Тестовые номера сгенерированы по официальному алгоритму контрольного
// разряда (два прохода весов по модулю 11); это не номера реальных лиц.
const VALID_IIN_M_1990 = '900515300008'; // муж., 1990-05-15
const VALID_IIN_M_1970 = '700301300002'; // муж., 1970-03-01
const VALID_IIN_F_2001 = '011231600005'; // жен., 2001-12-31
const IIN_NO_BIRTHDATE = '000000000000'; // 7-я цифра 0 — дата не закодирована
const IIN_BAD_DATE = '990230300005'; // 30 февраля, контрольный разряд сходится
const VALID_BIN_RESIDENT = '120540000001'; // рег. 2012-05, юр. лицо-резидент
const VALID_BIN_RESIDENT_2 = '201140000007'; // рег. 2020-11
const VALID_BIN_NONRESIDENT = '090550000008';
const VALID_BIN_JOINT = '150160000001';
const BIN_BAD_ENTITY_DIGIT = '120510000008'; // 5-я цифра 1
const BIN_BAD_MONTH = '121340000007'; // месяц 13
const CHECKSUM_ALWAYS_INVALID = '000000002810'; // оба прохода дают 10

describe('computeCheckDigit', () => {
  it('первый проход', () => {
    const digits = [...VALID_IIN_M_1990.slice(0, 11)].map(Number);
    expect(computeCheckDigit(digits)).toBe(8);
  });

  it('возвращает null, когда оба прохода дают 10', () => {
    const digits = [...CHECKSUM_ALWAYS_INVALID.slice(0, 11)].map(Number);
    expect(computeCheckDigit(digits)).toBeNull();
  });
});

describe('Iin', () => {
  it('парсит валидный ИИН и извлекает дату рождения и пол', () => {
    const iin = unwrap(Iin.parse(VALID_IIN_M_1990));
    expect(iin.value).toBe(VALID_IIN_M_1990);
    expect(iin.birthDate?.equals(LocalDate.of(1990, 5, 15))).toBe(true);
    expect(iin.sex).toBe('M');

    const woman = unwrap(Iin.parse(VALID_IIN_F_2001));
    expect(woman.birthDate?.equals(LocalDate.of(2001, 12, 31))).toBe(true);
    expect(woman.sex).toBe('F');

    const b1970 = unwrap(Iin.parse(VALID_IIN_M_1970));
    expect(b1970.birthDate?.year).toBe(1970);
  });

  it('терпит пробелы по краям', () => {
    expect(Iin.parse(` ${VALID_IIN_M_1990} `).ok).toBe(true);
  });

  it('ИИН без закодированной даты (7-я цифра вне 1–6) принимается без birthDate', () => {
    const iin = unwrap(Iin.parse(IIN_NO_BIRTHDATE));
    expect(iin.birthDate).toBeNull();
    expect(iin.sex).toBeNull();
  });

  it('отвергает неверный формат', () => {
    for (const bad of ['', '123', '90051530000', '9005153000088', '90051530000x']) {
      const r = Iin.parse(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('FORMAT');
    }
  });

  it('отвергает неверный контрольный разряд', () => {
    const r = Iin.parse('900515300009');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('CHECKSUM');
    const r2 = Iin.parse(CHECKSUM_ALWAYS_INVALID);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe('CHECKSUM');
  });

  it('отвергает несуществующую дату рождения', () => {
    const r = Iin.parse(IIN_BAD_DATE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('STRUCTURE');
  });

  it('equals и toJSON', () => {
    const a = unwrap(Iin.parse(VALID_IIN_M_1990));
    const b = unwrap(Iin.parse(VALID_IIN_M_1990));
    expect(a.equals(b)).toBe(true);
    expect(JSON.stringify(a)).toBe(`"${VALID_IIN_M_1990}"`);
  });
});

describe('Bin', () => {
  it('парсит валидный БИН: тип субъекта и дата регистрации', () => {
    const bin = unwrap(Bin.parse(VALID_BIN_RESIDENT));
    expect(bin.entityType).toBe('RESIDENT_LEGAL_ENTITY');
    expect(bin.registrationYear).toBe(2012);
    expect(bin.registrationMonth).toBe(5);

    expect(unwrap(Bin.parse(VALID_BIN_RESIDENT_2)).registrationYear).toBe(2020);
    expect(unwrap(Bin.parse(VALID_BIN_NONRESIDENT)).entityType).toBe('NON_RESIDENT_LEGAL_ENTITY');
    expect(unwrap(Bin.parse(VALID_BIN_JOINT)).entityType).toBe('JOINT_ENTREPRENEUR');
  });

  it('отвергает формат/контрольный разряд', () => {
    expect(Bin.parse('12054000000').ok).toBe(false);
    const r = Bin.parse('120540000002');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('CHECKSUM');
  });

  it('отвергает недопустимую 5-ю цифру и месяц', () => {
    const r1 = Bin.parse(BIN_BAD_ENTITY_DIGIT);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.kind).toBe('STRUCTURE');
    const r2 = Bin.parse(BIN_BAD_MONTH);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe('STRUCTURE');
  });

  it('equals и toJSON', () => {
    const a = unwrap(Bin.parse(VALID_BIN_RESIDENT));
    expect(a.equals(unwrap(Bin.parse(VALID_BIN_RESIDENT)))).toBe(true);
    expect(JSON.stringify(a)).toBe(`"${VALID_BIN_RESIDENT}"`);
  });
});
