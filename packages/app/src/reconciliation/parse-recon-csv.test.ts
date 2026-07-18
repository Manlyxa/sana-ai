import { describe, expect, it } from 'vitest';
import { reconcile, unwrap } from '@sana/domain';
import { parseReconCsv } from './parse-recon-csv';

describe('parseReconCsv', () => {
  it('разбирает CSV с датой/суммой/контрагентом; пустая дата — допустима', () => {
    const rows = unwrap(
      parseReconCsv('Дата;Сумма;Контрагент\n2026-07-05;84 500,00;ТОО «Каспий Строй»\n;65000;ИП Абенов'),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.amount.toDecimalString()).toBe('84500.00');
    expect(rows[0]!.row).toBe(2);
    expect(rows[1]!.date).toBeNull();
  });

  it('нечитаемая сумма и дата — ошибки с номерами строк, а не молчание', () => {
    const result = parseReconCsv('Дата;Сумма;Описание\n2026-07-01;не число;X\n32.13.2026;100;Y');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2);
    expect(result.error[0]!.row).toBe(2);
    expect(result.error[1]!.row).toBe(3);
  });

  it('файл без нужных колонок отклоняется с диагностикой', () => {
    const result = parseReconCsv('А;Б\n1;2');
    expect(result.ok).toBe(false);
  });
});

describe('полный конвейер: CSV → сверка → человеческий отчёт', () => {
  it('специально сконструированные файлы с 3 несовпадениями находят ровно 3', () => {
    const summary = [
      'Дата;Сумма;Контрагент',
      '2026-07-01;100000;Аренда офиса',
      '2026-07-03;84500;ТОО «Каспий Строй»', // в журнале 84 000
      '2026-07-07;250000;Оплата Каспий Строй',
      '2026-07-07;250000;Оплата Каспий Строй', // дубль
      '2026-07-12;65000;ИП Абенов',
    ].join('\n');
    const journal = [
      'Дата;Сумма;Контрагент',
      '2026-07-01;100000;Аренда офиса',
      '2026-07-03;84000;ТОО «Каспий Строй»',
      '2026-07-07;250000;Оплата Каспий Строй',
      ';65000;ИП Абенов', // пропущена дата
    ].join('\n');

    const report = reconcile(
      { name: 'сводная таблица', rows: unwrap(parseReconCsv(summary)) },
      { name: 'журнал проводок', rows: unwrap(parseReconCsv(journal)) },
    );
    expect(report.mismatches).toHaveLength(3);
    expect(report.mismatches.map((m) => m.kind).sort()).toEqual([
      'AMOUNT_DIFFERS',
      'DUPLICATE',
      'MISSING_DATE',
    ]);
    const missing = report.mismatches.find((m) => m.kind === 'MISSING_DATE')!;
    expect(missing.detail).toContain('датирует её 12.07');
  });
});
