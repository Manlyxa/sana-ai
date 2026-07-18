import { err, LocalDate, ok, type ReconRow, type Result } from '@sana/domain';
import { parseMoney } from '../accounting/journal-import';

/**
 * Разбор файла сверки (§12): CSV-выгрузка Excel с колонками
 * «дата», «сумма», «контрагент» (или «описание»/«назначение»).
 * Пустая дата допустима — это находка сверки, а не ошибка файла;
 * нечитаемая сумма — ошибка файла с номером строки.
 */

export type ReconParseError = { readonly row: number | null; readonly message: string };

const HEADER_ALIASES: Record<string, 'date' | 'amount' | 'counterparty'> = {
  'дата': 'date',
  'сумма': 'amount',
  'контрагент': 'counterparty',
  'описание': 'counterparty',
  'назначение': 'counterparty',
};

function detectDelimiter(headerLine: string): string {
  for (const d of [';', '\t', ',']) {
    if (headerLine.includes(d)) return d;
  }
  return ';';
}

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
}

export function parseReconCsv(csv: string): Result<readonly ReconRow[], readonly ReconParseError[]> {
  const lines = csv.split(/\r?\n/);
  const nonEmpty = lines.map((text, i) => ({ text, line: i + 1 })).filter((l) => l.text.trim() !== '');
  if (nonEmpty.length < 2) {
    return err([{ row: null, message: 'файл пуст: нужны заголовок и хотя бы одна строка данных' }]);
  }
  const header = nonEmpty[0]!;
  const delimiter = detectDelimiter(header.text);
  const headers = splitLine(header.text, delimiter).map((h) => HEADER_ALIASES[h.toLowerCase()] ?? null);
  for (const required of ['date', 'amount', 'counterparty'] as const) {
    if (!headers.includes(required)) {
      return err([
        {
          row: header.line,
          message: `нет колонки «${required === 'date' ? 'дата' : required === 'amount' ? 'сумма' : 'контрагент'}»`,
        },
      ]);
    }
  }

  const rows: ReconRow[] = [];
  const errors: ReconParseError[] = [];
  for (const { text, line } of nonEmpty.slice(1)) {
    const cells = splitLine(text, delimiter);
    const cell = (kind: 'date' | 'amount' | 'counterparty'): string => cells[headers.indexOf(kind)] ?? '';

    let date: LocalDate | null = null;
    const dateText = cell('date');
    if (dateText !== '') {
      const parsed = LocalDate.parse(dateText);
      if (!parsed.ok) {
        errors.push({ row: line, message: `нечитаемая дата «${dateText}» (ожидается ГГГГ-ММ-ДД)` });
        continue;
      }
      date = parsed.value;
    }
    const amount = parseMoney(cell('amount'));
    if (!amount.ok) {
      errors.push({ row: line, message: amount.error });
      continue;
    }
    const counterparty = cell('counterparty');
    if (counterparty === '') {
      errors.push({ row: line, message: 'пустой контрагент/описание' });
      continue;
    }
    rows.push({ row: line, date, amount: amount.value, counterparty });
  }
  if (errors.length > 0) return err(errors);
  return ok(rows);
}
