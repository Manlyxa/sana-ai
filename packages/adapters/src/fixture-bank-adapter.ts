import fs from 'node:fs';
import path from 'node:path';
import { Bin, err, ok, type Result } from '@sana/domain';
import type { BankPort, BankStatementLine, DateRange, PortError } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';
import { parseDecimalTenge, parseIsoDate } from './parse';

const HEADER = 'id;iban;date;direction;amount;counterparty_bin;counterparty_name;knp;purpose';

/** Fixture-адаптер банка: нормализованный CSV-импорт (per spec — сначала CSV/MT940). */
export class FixtureBankAdapter implements BankPort {
  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  async getStatement(
    accountIban: string,
    range: DateRange,
  ): Promise<Result<readonly BankStatementLine[], PortError>> {
    let text: string;
    try {
      text = fs.readFileSync(path.join(this.fixturesRoot, 'bank', 'statement-2026.csv'), 'utf8');
    } catch (e) {
      return err({ kind: 'IO', message: `чтение выписки: ${String(e)}` });
    }
    const rows = text.trim().split('\n');
    if (rows[0]?.trim() !== HEADER) {
      return err({ kind: 'PARSE', message: 'неожиданный заголовок CSV выписки' });
    }
    const lines: BankStatementLine[] = [];
    for (const row of rows.slice(1)) {
      const cols = row.split(';');
      if (cols.length !== 9) return err({ kind: 'PARSE', message: `строка CSV: "${row}"` });
      const [id, iban, dateRaw, directionRaw, amountRaw, binRaw, nameRaw, knpRaw, purpose] =
        cols as [string, string, string, string, string, string, string, string, string];
      if (iban !== accountIban) continue;
      if (directionRaw !== 'CREDIT' && directionRaw !== 'DEBIT') {
        return err({ kind: 'PARSE', message: `направление: "${directionRaw}"` });
      }
      const date = parseIsoDate(dateRaw);
      const amount = parseDecimalTenge(amountRaw);
      if (!date.ok) return err({ kind: 'PARSE', message: date.error });
      if (!amount.ok) return err({ kind: 'PARSE', message: amount.error });
      if (!date.value.isWithin(range.from, range.to)) continue;
      let counterpartyBin = null;
      if (binRaw !== '') {
        const parsed = Bin.parse(binRaw);
        if (!parsed.ok) return err({ kind: 'PARSE', message: `БИН в выписке: ${binRaw}` });
        counterpartyBin = parsed.value;
      }
      lines.push({
        id,
        accountIban: iban,
        bookingDate: date.value,
        direction: directionRaw,
        amount: amount.value,
        counterpartyBin,
        counterpartyName: nameRaw === '' ? null : nameRaw,
        knp: knpRaw === '' ? null : knpRaw,
        purpose,
      });
    }
    return ok(lines);
  }
}

export const DEMO_IBAN = 'KZ86601A000012345678';
