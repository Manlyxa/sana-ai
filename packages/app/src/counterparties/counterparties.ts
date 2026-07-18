import {
  Bin,
  counterpartyVerdict,
  err,
  Money,
  ok,
  type CounterpartyVerdict,
  type LedgerEntry,
  type Result,
} from '@sana/domain';
import type { CounterpartyRegistryPort } from '@sana/ports';

/**
 * Контрагенты (§7): один движок, два входа.
 *  (а) список контрагентов компании — агрегат по проводкам реестра
 *      (сделки, суммы) + статус риска из реестра КГД;
 *  (б) точечная проверка по БИН — явный вердикт «есть риск / нет риска»
 *      с причиной и нормой. Только чтение, без записи.
 */

export type CounterpartySummary = {
  readonly bin: string;
  readonly name: string;
  readonly deals: number;
  readonly totalAmount: Money;
  /** null — контрагента нет в реестре проверки (статус неизвестен). */
  readonly verdict: CounterpartyVerdict | null;
};

export type CheckError = { readonly message: string };

/** Итог одной проводки = сумма её дебетовых строк (равна кредитовым). */
function entryTotal(entry: LedgerEntry): Money {
  return entry.lines
    .filter((l) => l.side === 'DEBIT')
    .reduce((sum, l) => sum.add(l.amount), Money.zero());
}

/** (а) Список контрагентов компании по проводкам + статус риска. */
export async function listCompanyCounterparties(
  entries: readonly LedgerEntry[],
  registry: CounterpartyRegistryPort,
): Promise<readonly CounterpartySummary[]> {
  const grouped = new Map<string, { name: string; deals: number; total: Money }>();
  for (const entry of entries) {
    const bin = entry.analytics.counterpartyBin;
    if (bin === null) continue;
    const existing = grouped.get(bin) ?? {
      name: entry.analytics.counterpartyName ?? `БИН ${bin}`,
      deals: 0,
      total: Money.zero(),
    };
    existing.deals += 1;
    existing.total = existing.total.add(entryTotal(entry));
    if (entry.analytics.counterpartyName !== null) existing.name = entry.analytics.counterpartyName;
    grouped.set(bin, existing);
  }

  const summaries: CounterpartySummary[] = [];
  for (const [binValue, agg] of grouped) {
    let verdict: CounterpartyVerdict | null = null;
    const bin = Bin.parse(binValue);
    if (bin.ok) {
      const found = await registry.lookup(bin.value);
      if (found.ok) verdict = counterpartyVerdict(found.value);
    }
    summaries.push({
      bin: binValue,
      name: verdict?.name ?? agg.name,
      deals: agg.deals,
      totalAmount: agg.total,
      verdict,
    });
  }
  // Рисковые — первыми, дальше по обороту.
  return summaries.sort((a, b) => {
    const riskA = a.verdict?.risky === true ? 1 : 0;
    const riskB = b.verdict?.risky === true ? 1 : 0;
    if (riskA !== riskB) return riskB - riskA;
    return b.totalAmount.compareTo(a.totalAmount);
  });
}

export type CheckOutcome =
  | { readonly kind: 'FOUND'; readonly verdict: CounterpartyVerdict }
  | { readonly kind: 'NOT_FOUND'; readonly bin: string };

/** (б) Точечная проверка по БИН: явный вердикт или честное «не найден». */
export async function checkCounterparty(
  registry: CounterpartyRegistryPort,
  binInput: string,
): Promise<Result<CheckOutcome, CheckError>> {
  const cleaned = binInput.replace(/\D/g, '');
  const bin = Bin.parse(cleaned);
  if (!bin.ok) {
    return err({ message: `«${binInput}» не похоже на БИН: ${bin.error.message}` });
  }
  const found = await registry.lookup(bin.value);
  if (!found.ok) {
    if (found.error.kind === 'NOT_FOUND') return ok({ kind: 'NOT_FOUND', bin: cleaned });
    return err({ message: `реестр недоступен: ${found.error.message}` });
  }
  return ok({ kind: 'FOUND', verdict: counterpartyVerdict(found.value) });
}
