import type { LocalDate } from '../kernel/local-date';
import type { Money } from '../kernel/money';
import { formatTenge } from '../rules/helpers';

/**
 * Сверка данных (§12): построчное сопоставление одного или двух файлов
 * по ключевым полям (контрагент, дата, сумма). Результат — не технический
 * дифф, а конкретные утверждения по-русски: «сумма отличается на X»,
 * «дублирующая запись», «пропущена дата», «есть только в одном файле».
 * Детерминированно: одинаковый вход → одинаковый список несовпадений,
 * и одно расхождение порождает ровно одно замечание (без каскадов).
 */

export type ReconRow = {
  /** Номер строки в исходном файле (как видит его пользователь). */
  readonly row: number;
  readonly date: LocalDate | null;
  readonly amount: Money;
  readonly counterparty: string;
};

export type ReconSource = {
  readonly name: string;
  readonly rows: readonly ReconRow[];
};

export type MismatchKind = 'AMOUNT_DIFFERS' | 'DUPLICATE' | 'MISSING_DATE' | 'MISSING_IN_OTHER';

export type Mismatch = {
  readonly kind: MismatchKind;
  /** «Строка 118: сумма не совпадает». */
  readonly title: string;
  /** Объяснение человеческим языком, с суммами и датами. */
  readonly detail: string;
  /** CHECK → «Проверить», CLARIFY → «Уточнить». */
  readonly action: 'CHECK' | 'CLARIFY';
};

export type ReconciliationReport = {
  readonly mismatches: readonly Mismatch[];
  /** Всего строк во всех файлах. */
  readonly rowsCompared: number;
  /** Строк без замечаний. */
  readonly rowsMatched: number;
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
}

function shortDate(date: LocalDate): string {
  return `${String(date.day).padStart(2, '0')}.${String(date.month).padStart(2, '0')}`;
}

/** Полный ключ строки — для поиска дублей внутри файла. */
function fullKey(r: ReconRow): string {
  return `${normalizeName(r.counterparty)}|${r.date?.toISO() ?? '—'}|${r.amount.amount.toString()}`;
}

/** Ключ кросс-сопоставления между файлами. */
function matchKey(r: ReconRow): string {
  return `${normalizeName(r.counterparty)}|${r.date?.toISO() ?? '—'}`;
}

type SideScan = {
  /** Уникальные строки с датой — вход кросс-сопоставления. */
  readonly dated: ReconRow[];
  /** Строки без даты — кандидаты на «пропущена дата». */
  readonly undated: ReconRow[];
  readonly duplicates: Mismatch[];
  readonly flagged: Set<number>;
};

/** Внутри файла: дубли по (контрагент, дата, сумма); разбор с датой/без. */
function scanSide(source: ReconSource): SideScan {
  const duplicates: Mismatch[] = [];
  const flagged = new Set<number>();
  const seen = new Map<string, ReconRow>();
  const dated: ReconRow[] = [];
  const undated: ReconRow[] = [];

  for (const row of source.rows) {
    if (row.date === null) {
      undated.push(row);
      continue;
    }
    const first = seen.get(fullKey(row));
    if (first !== undefined) {
      duplicates.push({
        kind: 'DUPLICATE',
        title: `Строка ${row.row}: дублирующая запись`,
        detail:
          `Операция «${row.counterparty}» от ${shortDate(row.date)} на ${formatTenge(row.amount)} ` +
          `встречается в файле «${source.name}» дважды (строки ${first.row} и ${row.row}) — ` +
          'вероятно, внесена повторно при ручном вводе.',
        action: 'CHECK',
      });
      flagged.add(row.row);
      continue;
    }
    seen.set(fullKey(row), row);
    dated.push(row);
  }
  return { dated, undated, duplicates, flagged };
}

/**
 * «Пропущена дата»: если в другом файле есть та же операция (контрагент,
 * сумма) с датой — называем её и ПОГЛОЩАЕМ пару, чтобы она не породила
 * ложное «есть только в одном файле».
 */
function resolveUndated(
  source: ReconSource,
  undated: readonly ReconRow[],
  other: { name: string; dated: ReconRow[] } | null,
  flagged: Set<number>,
): Mismatch[] {
  return undated.map((row) => {
    let hint = ' Укажите дату вручную.';
    if (other !== null) {
      const idx = other.dated.findIndex(
        (r) =>
          normalizeName(r.counterparty) === normalizeName(row.counterparty) &&
          r.amount.equals(row.amount),
      );
      if (idx >= 0) {
        const counterpart = other.dated[idx]!;
        other.dated.splice(idx, 1);
        hint = ` Файл «${other.name}» датирует её ${shortDate(counterpart.date!)}.`;
      }
    }
    flagged.add(row.row);
    return {
      kind: 'MISSING_DATE' as const,
      title: `Строка ${row.row}: пропущена дата`,
      detail:
        `В файле «${source.name}» нет даты у операции «${row.counterparty}» на ${formatTenge(row.amount)}.` +
        hint,
      action: 'CLARIFY' as const,
    };
  });
}

function missingInOther(row: ReconRow, presentIn: string, absentIn: string): Mismatch {
  return {
    kind: 'MISSING_IN_OTHER',
    title: `Строка ${row.row}: есть только в одном файле`,
    detail:
      `Операция «${row.counterparty}» от ${row.date === null ? '—' : shortDate(row.date)} ` +
      `на ${formatTenge(row.amount)} есть в файле «${presentIn}», но отсутствует в «${absentIn}».`,
    action: 'CHECK',
  };
}

export function reconcile(left: ReconSource, right: ReconSource | null): ReconciliationReport {
  const leftScan = scanSide(left);
  const rightScan = right === null ? null : scanSide(right);

  const flaggedLeft = leftScan.flagged;
  const flaggedRight = rightScan?.flagged ?? new Set<number>();
  const mismatches: Mismatch[] = [...leftScan.duplicates, ...(rightScan?.duplicates ?? [])];

  mismatches.push(
    ...resolveUndated(
      left,
      leftScan.undated,
      rightScan === null ? null : { name: right!.name, dated: rightScan.dated },
      flaggedLeft,
    ),
  );
  if (right !== null && rightScan !== null) {
    mismatches.push(
      ...resolveUndated(right, rightScan.undated, { name: left.name, dated: leftScan.dated }, flaggedRight),
    );

    // Кросс-сопоставление по (контрагент, дата): очередь строк на ключ.
    const rightByKey = new Map<string, ReconRow[]>();
    for (const row of rightScan.dated) {
      const list = rightByKey.get(matchKey(row)) ?? [];
      list.push(row);
      rightByKey.set(matchKey(row), list);
    }

    for (const row of leftScan.dated) {
      const candidate = (rightByKey.get(matchKey(row)) ?? []).shift();
      if (candidate === undefined) {
        mismatches.push(missingInOther(row, left.name, right.name));
        flaggedLeft.add(row.row);
      } else if (!candidate.amount.equals(row.amount)) {
        const diff = row.amount.subtract(candidate.amount).abs();
        mismatches.push({
          kind: 'AMOUNT_DIFFERS',
          title: `Строка ${row.row}: сумма не совпадает`,
          detail:
            `В файле «${left.name}» указано ${formatTenge(row.amount)}, ` +
            `в файле «${right.name}» — ${formatTenge(candidate.amount)}. ` +
            `Разница ${formatTenge(diff)}, похоже на опечатку при ручном вводе.`,
          action: 'CHECK',
        });
        flaggedLeft.add(row.row);
        flaggedRight.add(candidate.row);
      }
    }

    // Остатки справа, к которым не нашлось пары слева.
    for (const list of rightByKey.values()) {
      for (const row of list) {
        mismatches.push(missingInOther(row, right.name, left.name));
        flaggedRight.add(row.row);
      }
    }
  }

  const rowsCompared = left.rows.length + (right?.rows.length ?? 0);
  return {
    mismatches,
    rowsCompared,
    rowsMatched: rowsCompared - flaggedLeft.size - flaggedRight.size,
  };
}
