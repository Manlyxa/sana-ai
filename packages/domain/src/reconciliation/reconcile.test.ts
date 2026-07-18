import { describe, expect, it } from 'vitest';
import { LocalDate } from '../kernel/local-date';
import { Money } from '../kernel/money';
import { unwrap } from '../kernel/result';
import { reconcile, type ReconRow, type ReconSource } from './reconcile';

const D = (iso: string) => unwrap(LocalDate.parse(iso));

function row(rowNum: number, dateIso: string | null, tenge: number, counterparty: string): ReconRow {
  return {
    row: rowNum,
    date: dateIso === null ? null : D(dateIso),
    amount: Money.ofMajor(tenge),
    counterparty,
  };
}

/** Совпадающая «основа» из N операций в обоих файлах. */
function base(n: number, startRow: number): ReconRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(startRow + i, `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, 10_000 + i * 100, `Поставщик ${i}`),
  );
}

describe('сверка двух файлов', () => {
  it('файл с ровно тремя известными расхождениями даёт ровно эти три — не больше и не меньше', () => {
    // Сводная таблица: 100 совпадающих строк + три специально испорченных.
    const summary: ReconSource = {
      name: 'сводная таблица',
      rows: [
        ...base(100, 2),
        row(118, '2026-07-03', 84_500, 'ТОО «Каспий Строй»'), // сумма отличается
        row(231, '2026-07-07', 250_000, 'Оплата Каспий Строй'), // дубль ниже
        row(232, '2026-07-07', 250_000, 'Оплата Каспий Строй'), // дублирующая запись
        row(340, '2026-07-12', 65_000, 'ИП Абенов'), // в журнале без даты
      ],
    };
    const journal: ReconSource = {
      name: 'журнал проводок',
      rows: [
        ...base(100, 2),
        row(118, '2026-07-03', 84_000, 'ТОО «Каспий Строй»'), // 84 000 против 84 500
        row(231, '2026-07-07', 250_000, 'Оплата Каспий Строй'),
        row(340, null, 65_000, 'ИП Абенов'), // пропущена дата
      ],
    };

    const report = reconcile(summary, journal);
    expect(report.mismatches).toHaveLength(3);

    const kinds = report.mismatches.map((m) => m.kind).sort();
    expect(kinds).toEqual(['AMOUNT_DIFFERS', 'DUPLICATE', 'MISSING_DATE']);

    const amount = report.mismatches.find((m) => m.kind === 'AMOUNT_DIFFERS')!;
    expect(amount.title).toBe('Строка 118: сумма не совпадает');
    expect(amount.detail).toContain('84 500 ₸');
    expect(amount.detail).toContain('84 000 ₸');
    expect(amount.detail).toContain('Разница 500 ₸');

    const dup = report.mismatches.find((m) => m.kind === 'DUPLICATE')!;
    expect(dup.title).toBe('Строка 232: дублирующая запись');
    expect(dup.detail).toContain('строки 231 и 232');

    const missing = report.mismatches.find((m) => m.kind === 'MISSING_DATE')!;
    expect(missing.title).toBe('Строка 340: пропущена дата');
    expect(missing.detail).toContain('датирует её 12.07');
    expect(missing.action).toBe('CLARIFY');

    // 207 строк всего (104 + 103), 4 с замечаниями (118 в обоих, 232, 340).
    expect(report.rowsCompared).toBe(207);
    expect(report.rowsMatched).toBe(203);
  });

  it('одинаковый вход → одинаковый отчёт (детерминизм)', () => {
    const a: ReconSource = { name: 'а', rows: [...base(30, 2), row(50, null, 777, 'X')] };
    const b: ReconSource = { name: 'б', rows: base(30, 2) };
    const r1 = reconcile(a, b);
    const r2 = reconcile(a, b);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('операция только в одном файле называется по имени файла', () => {
    const a: ReconSource = { name: 'банк', rows: [row(5, '2026-07-01', 1000, 'А')] };
    const b: ReconSource = { name: 'журнал', rows: [] };
    const report = reconcile(a, b);
    expect(report.mismatches).toHaveLength(1);
    expect(report.mismatches[0]!.kind).toBe('MISSING_IN_OTHER');
    expect(report.mismatches[0]!.detail).toContain('есть в файле «банк», но отсутствует в «журнал»');
  });
});

describe('сверка одного файла', () => {
  it('находит дубли и пропущенные даты без второго файла', () => {
    const single: ReconSource = {
      name: 'сводная',
      rows: [
        row(2, '2026-07-01', 500, 'А'),
        row(3, '2026-07-01', 500, 'А'), // дубль
        row(4, null, 900, 'Б'), // без даты
      ],
    };
    const report = reconcile(single, null);
    expect(report.mismatches.map((m) => m.kind).sort()).toEqual(['DUPLICATE', 'MISSING_DATE']);
    expect(report.mismatches.find((m) => m.kind === 'MISSING_DATE')!.detail).toContain('Укажите дату вручную');
    expect(report.rowsMatched).toBe(1);
  });
});
