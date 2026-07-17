import { describe, expect, it } from 'vitest';
import { balanceSheet, LocalDate, profitLossStatement, TaxPeriod, unwrap } from '@sana/domain';
import { importJournalCsv, parseMoney } from './journal-import';

const ARGS = { companyId: 'co-1', fileName: 'journal.csv' };

const GOOD_CSV = [
  'Дата;Счёт Дт;Счёт Кт;Сумма;Описание;Операция',
  '2026-01-05;1030;5030;1000000;Взнос в уставный капитал;',
  '2026-01-15;1210;6010;800000,50;Реализация услуг;',
  '2026-02-10;7210;1030;200 000;Аренда офиса;',
  // Составная операция: продажа с НДС тремя строками.
  '2026-02-15;1210;;116000;Реализация с НДС;оп-1',
  '2026-02-15;;6010;100000;Реализация с НДС;оп-1',
  '2026-02-15;;3130;16000;Реализация с НДС;оп-1',
].join('\n');

describe('parseMoney', () => {
  it('parses decimal strings into тиын without floating point', () => {
    expect(unwrap(parseMoney('12345.67')).amount).toBe(1234567n);
    expect(unwrap(parseMoney('12 345,6')).amount).toBe(1234560n);
    expect(unwrap(parseMoney('-500')).amount).toBe(-50000n);
    expect(parseMoney('12.345').ok).toBe(false);
    expect(parseMoney('abc').ok).toBe(false);
    expect(parseMoney('1e5').ok).toBe(false);
  });
});

describe('importJournalCsv', () => {
  it('imports a valid file, including compound operations', () => {
    const result = unwrap(importJournalCsv(GOOD_CSV, ARGS));
    expect(result.entries).toHaveLength(4);
    expect(result.balanced).toBe(true);
    const compound = result.entries.find((e) => e.memo === 'Реализация с НДС');
    expect(compound?.lines).toHaveLength(3);
    expect(compound?.sourceEventId).toContain('journal.csv');
    // Импортированная книга даёт согласованные отчёты Module 4.
    const bs = balanceSheet(result.entries, unwrap(LocalDate.parse('2026-03-31')));
    expect(bs.balanced).toBe(true);
    const pl = profitLossStatement(result.entries, TaxPeriod.quarter(2026, 1));
    expect(pl.revenue.total.toDecimalString()).toBe('900000.50');
  });

  it('rejects an intentionally unbalanced compound operation with a clear message', () => {
    const csv = [
      'Дата;Счёт Дт;Счёт Кт;Сумма;Описание;Операция',
      '2026-02-15;1210;;116000;Реализация с НДС;оп-1',
      '2026-02-15;;6010;100000;Реализация с НДС;оп-1',
    ].join('\n');
    const result = importJournalCsv(csv, ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.message).toContain('не сбалансирована');
      expect(result.error[0]?.message).toContain('116000.00');
      expect(result.error[0]?.message).toContain('100000.00');
    }
  });

  it('reports every invalid row with its number', () => {
    const csv = [
      'Дата;Счёт Дт;Счёт Кт;Сумма;Описание',
      '2026-13-01;1030;5030;100;Плохая дата',
      '2026-01-05;9999;5030;100;Плохой счёт',
      '2026-01-05;1030;5030;-1;Плохая сумма',
      '2026-01-05;1030;5030;сто;Не число',
      '2026-01-05;;;100;Нет счетов',
      '2026-01-05;1030;5030;100;',
    ].join('\n');
    const result = importJournalCsv(csv, ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveLength(6);
      expect(result.error.map((d) => d.row)).toEqual([2, 3, 4, 5, 6, 7]);
      expect(result.error[1]?.message).toContain('9999');
    }
  });

  it('rejects files with a broken header or no rows', () => {
    const noHeader = importJournalCsv('Дата;Сумма\n2026-01-05;100', ARGS);
    expect(noHeader.ok).toBe(false);
    if (!noHeader.ok) expect(noHeader.error[0]?.message).toContain('Счёт Дт');
    expect(importJournalCsv('', ARGS).ok).toBe(false);
    expect(importJournalCsv('Дата;Счёт Дт;Счёт Кт;Сумма;Описание', ARGS).ok).toBe(false);
  });

  it('requires an operation id for one-sided rows', () => {
    const csv = ['Дата;Счёт Дт;Счёт Кт;Сумма;Описание;Операция', '2026-02-15;1210;;116000;Продажа;'].join('\n');
    const result = importJournalCsv(csv, ARGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toContain('Операция');
  });

  it('supports comma and tab delimiters', () => {
    const comma = ['Дата,Дт,Кт,Сумма,Описание', '2026-01-05,1030,5030,100,Взнос'].join('\n');
    expect(unwrap(importJournalCsv(comma, ARGS)).entries).toHaveLength(1);
    const tab = ['Дата\tДт\tКт\tСумма\tОписание', '2026-01-05\t1030\t5030\t100\tВзнос'].join('\n');
    expect(unwrap(importJournalCsv(tab, ARGS)).entries).toHaveLength(1);
  });
});
