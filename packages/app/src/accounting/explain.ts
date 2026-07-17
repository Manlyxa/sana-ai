import {
  balanceSheet,
  cashFlowStatement,
  err,
  ok,
  profitLossStatement,
  type BusinessEvent,
  type LedgerEntry,
  type Result,
  type TaxPeriod,
} from '@sana/domain';

/**
 * «Объясни эту цифру» (Module 5): a universal explanation for any number
 * in the system — journal entry or report line — as a chain
 *
 *   Факт (исходное событие/документ)
 *     ↓ Правило (применённая логика + норма НК РК + версия параметров)
 *     ↓ Результат (итоговая сумма)
 */

export type Explanation = {
  /** Что объясняем — по-русски. */
  readonly subject: string;
  /** Факт: исходное событие или документ-основание. */
  readonly fact: string;
  /** Применённое правило или расчёт. */
  readonly rule: string;
  /** Итоговый результат. */
  readonly result: string;
  /** Машиночитаемые ссылки для аудита. */
  readonly references: {
    readonly sourceEventIds: readonly string[];
    readonly entryIds: readonly string[];
    readonly norm: string | null;
    readonly legalParamsVersion: string | null;
  };
};

function describeEvent(event: BusinessEvent): string {
  const doc = event.sourceDocumentRef;
  const docText = doc === null ? 'без документа-основания' : `${doc.documentType} № ${doc.documentId} (${doc.system})`;
  return `Событие ${event.id} от ${event.occurredAt.toISO()} из системы «${event.sourceSystem}»: ${docText}.`;
}

function describeLines(entry: LedgerEntry): string {
  return entry.lines
    .map((l) => `${l.side === 'DEBIT' ? 'Дт' : 'Кт'} ${l.account} — ${l.amount.toDecimalString()} тенге`)
    .join('; ');
}

/** Explains a single ledger entry; `event` — its source event if known. */
export function explainLedgerEntry(entry: LedgerEntry, event: BusinessEvent | null): Explanation {
  const fact = event !== null ? describeEvent(event) : `Источник: ${entry.sourceEventId}.`;
  const reversal = entry.reversesEntryId !== null ? ` Является сторно проводки ${entry.reversesEntryId}.` : '';
  const norm = entry.norm !== null ? ` Норма: ${entry.norm}.` : '';
  return {
    subject: `Проводка ${entry.id}: ${entry.memo}`,
    fact,
    rule: `Двойная запись за период ${entry.period.code()}: ${describeLines(entry)}.${norm}${reversal} Версия параметров: ${entry.legalParamsVersion}.`,
    result: `Проводка от ${entry.date.toISO()} на сумму ${entry.lines[0]?.amount.toDecimalString() ?? '0.00'} тенге: ${entry.memo}.`,
    references: {
      sourceEventIds: [entry.sourceEventId],
      entryIds: [entry.id],
      norm: entry.norm,
      legalParamsVersion: entry.legalParamsVersion,
    },
  };
}

/**
 * Explains a report line by its stable id («bs:assets:1030»,
 * «pl:revenue:6010», «cf:<entryId>:<account>») for the given period.
 */
export function explainReportLine(args: {
  readonly lineId: string;
  readonly entries: readonly LedgerEntry[];
  readonly period: TaxPeriod;
}): Result<Explanation, string> {
  const { lineId, entries, period } = args;
  const byId = new Map(entries.map((e) => [e.id, e]));

  const explain = (
    subject: string,
    rule: string,
    amountText: string,
    entryIds: readonly string[],
  ): Explanation => {
    const sources = entryIds.map((id) => byId.get(id)?.sourceEventId).filter((s): s is string => s !== undefined);
    return {
      subject,
      fact: `Строка сформирована ${entryIds.length} проводками: ${entryIds.join(', ')} (события-основания: ${sources.join(', ')}).`,
      rule,
      result: amountText,
      references: {
        sourceEventIds: sources,
        entryIds,
        norm: null,
        legalParamsVersion: byId.get(entryIds[0] ?? '')?.legalParamsVersion ?? null,
      },
    };
  };

  if (lineId.startsWith('bs:')) {
    const bs = balanceSheet(entries, period.end());
    const line = [...bs.assets.lines, ...bs.liabilities.lines, ...bs.equity.lines].find((l) => l.id === lineId);
    if (line === undefined) return err(`строка баланса «${lineId}» не найдена`);
    return ok(
      explain(
        `Баланс на ${period.end().toISO()}: ${line.label}`,
        `Сальдо счёта ${line.account} по всем проводкам по ${period.end().toISO()} включительно; контроль: Активы = Обязательства + Капитал.`,
        `${line.amount.toDecimalString()} тенге`,
        line.entryIds,
      ),
    );
  }
  if (lineId.startsWith('pl:')) {
    const pl = profitLossStatement(entries, period);
    const line = [...pl.revenue.lines, ...pl.expenses.lines].find((l) => l.id === lineId);
    if (line === undefined) return err(`строка ОПиУ «${lineId}» не найдена`);
    return ok(
      explain(
        `ОПиУ за ${period.code()}: ${line.label}`,
        `Оборот счёта ${line.account} за период ${period.code()} (доходы — по Кт, расходы — по Дт, сторно уменьшает).`,
        `${line.amount.toDecimalString()} тенге`,
        line.entryIds,
      ),
    );
  }
  if (lineId.startsWith('cf:')) {
    const cf = cashFlowStatement(entries, period);
    const item = [...cf.operating.items, ...cf.investing.items, ...cf.financing.items].find((i) => i.id === lineId);
    if (item === undefined) return err(`строка ОДДС «${lineId}» не найдена`);
    const section =
      item.activity === 'OPERATING' ? 'операционной' : item.activity === 'INVESTING' ? 'инвестиционной' : 'финансовой';
    return ok(
      explain(
        `ОДДС за ${period.code()}: ${item.memo}`,
        `Движение денег (прямой метод) по контр-счёту ${item.counterAccount} — отнесено к ${section} деятельности.`,
        `${item.amount.toDecimalString()} тенге`,
        [item.entryId],
      ),
    );
  }
  return err(`неизвестный id строки отчёта: «${lineId}» (ожидается префикс bs:, pl: или cf:)`);
}
