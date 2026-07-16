import { err, ok, type Result } from './result';
import { LocalDate, daysInMonth } from './local-date';

/**
 * БИН и ИИН — 12-значные идентификаторы РК с контрольным разрядом
 * (ГОСТ-алгоритм: два прохода весов по модулю 11).
 */

const WEIGHTS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const WEIGHTS_2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2] as const;
const TWELVE_DIGITS_RE = /^\d{12}$/;

export type IdError =
  | { kind: 'FORMAT'; message: string }
  | { kind: 'CHECKSUM'; message: string }
  | { kind: 'STRUCTURE'; message: string };

function digitsOf(value: string): number[] {
  return [...value].map((c) => Number(c));
}

/** Контрольный разряд или null, если число невалидно (второй проход дал 10). */
export function computeCheckDigit(first11: readonly number[]): number | null {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += (first11[i] as number) * (WEIGHTS_1[i] as number);
  let control = sum % 11;
  if (control === 10) {
    sum = 0;
    for (let i = 0; i < 11; i++) sum += (first11[i] as number) * (WEIGHTS_2[i] as number);
    control = sum % 11;
    if (control === 10) return null;
  }
  return control;
}

function verifyChecksum(value: string): Result<number[], IdError> {
  if (!TWELVE_DIGITS_RE.test(value)) {
    return err({ kind: 'FORMAT', message: `ожидается 12 цифр: "${value}"` });
  }
  const digits = digitsOf(value);
  const expected = computeCheckDigit(digits.slice(0, 11));
  if (expected === null || expected !== digits[11]) {
    return err({ kind: 'CHECKSUM', message: `неверный контрольный разряд: "${value}"` });
  }
  return ok(digits);
}

/** 7-я цифра ИИН: век и пол. 1,3,5 — мужчины; 2,4,6 — женщины. */
const CENTURY_BY_DIGIT: Record<number, number> = {
  1: 1800, 2: 1800,
  3: 1900, 4: 1900,
  5: 2000, 6: 2000,
};

export type Sex = 'M' | 'F';

export class Iin {
  private constructor(
    readonly value: string,
    /** Дата рождения, если она закодирована корректно (7-я цифра 1–6). */
    readonly birthDate: LocalDate | null,
    readonly sex: Sex | null,
  ) {}

  static parse(raw: string): Result<Iin, IdError> {
    const checked = verifyChecksum(raw.trim());
    if (!checked.ok) return checked;
    const digits = checked.value;
    const value = raw.trim();

    const centuryDigit = digits[6] as number;
    const century = CENTURY_BY_DIGIT[centuryDigit];
    if (century === undefined) {
      // ИИН нерезидента и служебные диапазоны не кодируют дату — принимаем без неё.
      return ok(new Iin(value, null, null));
    }
    const year = century + Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      return err({ kind: 'STRUCTURE', message: `ИИН кодирует несуществующую дату рождения: "${value}"` });
    }
    const sex: Sex = centuryDigit % 2 === 1 ? 'M' : 'F';
    return ok(new Iin(value, LocalDate.of(year, month, day), sex));
  }

  equals(other: Iin): boolean {
    return this.value === other.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/** 5-я цифра БИН: 4 — юр. лицо-резидент, 5 — нерезидент, 6 — ИП (совместное). */
export type BinEntityType = 'RESIDENT_LEGAL_ENTITY' | 'NON_RESIDENT_LEGAL_ENTITY' | 'JOINT_ENTREPRENEUR';

const ENTITY_TYPE_BY_DIGIT: Record<number, BinEntityType> = {
  4: 'RESIDENT_LEGAL_ENTITY',
  5: 'NON_RESIDENT_LEGAL_ENTITY',
  6: 'JOINT_ENTREPRENEUR',
};

export class Bin {
  private constructor(
    readonly value: string,
    readonly entityType: BinEntityType,
    /** Год и месяц регистрации, закодированные в первых четырёх цифрах. */
    readonly registrationYear: number,
    readonly registrationMonth: number,
  ) {}

  static parse(raw: string): Result<Bin, IdError> {
    const checked = verifyChecksum(raw.trim());
    if (!checked.ok) return checked;
    const digits = checked.value;
    const value = raw.trim();

    const entityType = ENTITY_TYPE_BY_DIGIT[digits[4] as number];
    if (entityType === undefined) {
      return err({ kind: 'STRUCTURE', message: `5-я цифра БИН должна быть 4, 5 или 6: "${value}"` });
    }
    const month = Number(value.slice(2, 4));
    if (month < 1 || month > 12) {
      return err({ kind: 'STRUCTURE', message: `месяц регистрации вне диапазона: "${value}"` });
    }
    // Двузначный год регистрации: БИН введены в 2000-х.
    const year = 2000 + Number(value.slice(0, 2));
    return ok(new Bin(value, entityType, year, month));
  }

  equals(other: Bin): boolean {
    return this.value === other.value;
  }

  toJSON(): string {
    return this.value;
  }
}
