import {
  CHART_OF_ACCOUNTS_VERSION,
  err,
  isKnownAccount,
  LocalDate,
  Money,
  ok,
  trialBalance,
  TaxPeriod,
  EMPTY_ANALYTICS,
  createLedgerEntry,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerLine,
  type Result,
} from '@sana/domain';

/**
 * Journal import (Module 4): parses tabular journal entries exported from
 * Excel (CSV — «CSV (разделители — точка с запятой)» или запятая/таб) and
 * converts them into Module 1 ledger entries.
 *
 * Expected columns (header row, Russian, case-insensitive):
 *   Дата; Счёт Дт; Счёт Кт; Сумма; Описание[; Операция]
 *
 * Row forms:
 *  - both Дт and Кт filled → a standalone balanced entry;
 *  - only one side filled → the row belongs to a compound operation
 *    (grouped by «Операция»), which must balance as a whole.
 *
 * Every diagnostic is in Russian and cites the exact row number. A file
 * that does not balance is rejected as a whole — nothing is imported.
 */

export type ImportDiagnostic = {
  /** Номер строки файла (1 — заголовок). */
  readonly row: number | null;
  readonly message: string;
};

export type ImportResult = {
  readonly entries: readonly LedgerEntry[];
  /** Итоговая ОСВ импортированного файла сбалансирована (Дт = Кт). */
  readonly balanced: true;
};

type ParsedRow = {
  readonly rowNumber: number;
  readonly date: LocalDate;
  readonly debitAccount: string | null;
  readonly creditAccount: string | null;
  readonly amount: Money;
  readonly description: string;
  readonly operation: string | null;
};

/** «12 345,67» / «12345.67» / «12345» → тиын (bigint), без плавающей точки. */
export function parseMoney(text: string): Result<Money, string> {
  const normalized = text.replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (m === null) return err(`не является суммой: «${text}»`);
  const sign = m[1] === '-' ? -1n : 1n;
  const major = BigInt(m[2] as string);
  const minor = BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return ok(Money.ofMinor(sign * (major * 100n + minor)));
}

const HEADER_ALIASES: Record<string, 'date' | 'debit' | 'credit' | 'amount' | 'description' | 'operation'> = {
  'дата': 'date',
  'счёт дт': 'debit',
  'счет дт': 'debit',
  'дт': 'debit',
  'счёт кт': 'credit',
  'счет кт': 'credit',
  'кт': 'credit',
  'сумма': 'amount',
  'описание': 'description',
  'операция': 'operation',
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

/** Parses CSV text into rows; collects all row-level diagnostics at once. */
function parseRows(csv: string): Result<readonly ParsedRow[], readonly ImportDiagnostic[]> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return err([{ row: null, message: 'файл пуст: нужны строка заголовка и хотя бы одна проводка' }]);
  }
  const delimiter = detectDelimiter(lines[0] as string);
  const headers = splitLine(lines[0] as string, delimiter).map((h) => HEADER_ALIASES[h.toLowerCase()] ?? null);
  const required: readonly ('date' | 'debit' | 'credit' | 'amount' | 'description')[] = [
    'date',
    'debit',
    'credit',
    'amount',
    'description',
  ];
  const missing = required.filter((r) => !headers.includes(r));
  if (missing.length > 0) {
    return err([
      {
        row: 1,
        message:
          'в заголовке не найдены колонки: ' +
          missing
            .map((f) => ({ date: 'Дата', debit: 'Счёт Дт', credit: 'Счёт Кт', amount: 'Сумма', description: 'Описание' })[f])
            .join(', '),
      },
    ]);
  }

  const diagnostics: ImportDiagnostic[] = [];
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const cells = splitLine(lines[i] as string, delimiter);
    const field = (name: (typeof HEADER_ALIASES)[string]): string => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? (cells[idx] ?? '') : '';
    };

    const dateResult = LocalDate.parse(field('date'));
    if (!dateResult.ok) {
      diagnostics.push({ row: rowNumber, message: `неверная дата: ${dateResult.error}` });
      continue;
    }
    const debit = field('debit') || null;
    const credit = field('credit') || null;
    if (debit === null && credit === null) {
      diagnostics.push({ row: rowNumber, message: 'не указан ни счёт Дт, ни счёт Кт' });
      continue;
    }
    let accountsOk = true;
    for (const account of [debit, credit]) {
      if (account !== null && !isKnownAccount(account)) {
        diagnostics.push({ row: rowNumber, message: `неизвестный счёт «${account}» — отсутствует в рабочем плане счетов` });
        accountsOk = false;
      }
    }
    if (!accountsOk) continue;
    const amountResult = parseMoney(field('amount'));
    if (!amountResult.ok) {
      diagnostics.push({ row: rowNumber, message: amountResult.error });
      continue;
    }
    if (!amountResult.value.isPositive()) {
      diagnostics.push({ row: rowNumber, message: 'сумма должна быть больше нуля' });
      continue;
    }
    const description = field('description');
    if (description === '') {
      diagnostics.push({ row: rowNumber, message: 'описание обязательно' });
      continue;
    }
    rows.push({
      rowNumber,
      date: dateResult.value,
      debitAccount: debit,
      creditAccount: credit,
      amount: amountResult.value,
      description,
      operation: field('operation') || null,
    });
  }
  if (diagnostics.length > 0) return err(diagnostics);
  return ok(rows);
}

/** Converts validated rows into ledger entries; compound operations must balance. */
function rowsToEntries(
  rows: readonly ParsedRow[],
  args: { companyId: string; fileName: string },
): Result<readonly LedgerEntry[], readonly ImportDiagnostic[]> {
  const diagnostics: ImportDiagnostic[] = [];
  const inputs: LedgerEntryInput[] = [];
  const groups = new Map<string, ParsedRow[]>();
  let entrySeq = 0;

  const makeInput = (rowsOfEntry: readonly ParsedRow[], lines: readonly LedgerLine[]): LedgerEntryInput => {
    entrySeq += 1;
    const first = rowsOfEntry[0] as ParsedRow;
    return {
      id: `le-import-${args.fileName}-${entrySeq}`,
      companyId: args.companyId,
      sourceEventId: `import:${args.fileName}:строки:${rowsOfEntry.map((r) => r.rowNumber).join('+')}`,
      date: first.date,
      lines,
      memo: first.description,
      analytics: EMPTY_ANALYTICS,
      norm: null,
      legalParamsVersion: CHART_OF_ACCOUNTS_VERSION,
      reversesEntryId: null,
    };
  };

  for (const row of rows) {
    if (row.debitAccount !== null && row.creditAccount !== null) {
      inputs.push(
        makeInput(
          [row],
          [
            { account: row.debitAccount, side: 'DEBIT', amount: row.amount },
            { account: row.creditAccount, side: 'CREDIT', amount: row.amount },
          ],
        ),
      );
      continue;
    }
    // Односторонняя строка — часть составной операции.
    const key = row.operation ?? `строка-${row.rowNumber}`;
    if (row.operation === null) {
      diagnostics.push({
        row: row.rowNumber,
        message: 'у односторонней строки должна быть заполнена колонка «Операция» для группировки',
      });
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const [operation, group] of groups) {
    const lines: LedgerLine[] = group.map((row) => ({
      account: (row.debitAccount ?? row.creditAccount) as string,
      side: row.debitAccount !== null ? ('DEBIT' as const) : ('CREDIT' as const),
      amount: row.amount,
    }));
    const debit = lines.filter((l) => l.side === 'DEBIT').reduce((a, l) => a.add(l.amount), Money.zero());
    const credit = lines.filter((l) => l.side === 'CREDIT').reduce((a, l) => a.add(l.amount), Money.zero());
    if (!debit.equals(credit)) {
      diagnostics.push({
        row: group[0]?.rowNumber ?? null,
        message: `операция «${operation}» не сбалансирована: Дт ${debit.toDecimalString()} ≠ Кт ${credit.toDecimalString()} — файл отклонён`,
      });
      continue;
    }
    inputs.push(makeInput(group, lines));
  }

  if (diagnostics.length > 0) return err(diagnostics);

  const entries: LedgerEntry[] = [];
  for (const input of inputs) {
    const created = createLedgerEntry(input);
    if (!created.ok) {
      diagnostics.push({ row: null, message: created.error.message });
      continue;
    }
    entries.push(created.value);
  }
  if (diagnostics.length > 0) return err(diagnostics);
  return ok(entries);
}

/**
 * Imports a CSV journal (Excel export). All-or-nothing: any diagnostic —
 * row-level or file-level — rejects the whole file.
 */
export function importJournalCsv(
  csv: string,
  args: { readonly companyId: string; readonly fileName: string },
): Result<ImportResult, readonly ImportDiagnostic[]> {
  const rows = parseRows(csv);
  if (!rows.ok) return rows;
  const entries = rowsToEntries(rows.value, args);
  if (!entries.ok) return entries;
  if (entries.value.length === 0) {
    return err([{ row: null, message: 'файл не содержит ни одной проводки' }]);
  }
  // Контроль всего файла: итоговая ОСВ обязана сойтись.
  const years = new Set(entries.value.map((e) => e.date.year));
  for (const year of years) {
    const tb = trialBalance(entries.value, TaxPeriod.year(year));
    if (!tb.balanced) {
      return err([
        {
          row: null,
          message: `импортированная книга за ${year} год не сбалансирована: Дт ${tb.totals.turnoverDebit.toDecimalString()} ≠ Кт ${tb.totals.turnoverCredit.toDecimalString()}`,
        },
      ]);
    }
  }
  return ok({ entries: entries.value, balanced: true });
}
