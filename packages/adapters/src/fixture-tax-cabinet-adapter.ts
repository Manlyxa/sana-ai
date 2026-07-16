import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  err,
  ok,
  TaxPeriod,
  unwrap,
  type Bin,
  type Result,
  type TaxNotice,
  type TaxObligation,
} from '@sana/domain';
import { LocalDate } from '@sana/domain';
import type {
  FnoReceipt,
  LedgerBalance,
  PortError,
  PreparedFno,
  SignatureArtifact,
  SurRiskCategory,
  TaxCabinetPort,
} from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';
import { parseDecimalTenge } from './parse';

const obligationSchema = z.object({
  id: z.string(),
  kind: z.enum(['ФНО_100', 'ФНО_200', 'ФНО_300', 'ФНО_910', 'НДС_ПЛАТЁЖ', 'КПН_ПЛАТЁЖ', 'ЗАРПЛАТНЫЕ_ПЛАТЕЖИ']),
  period: z.string(),
  dueDate: z.string(),
  amount: z.string().nullable(),
  status: z.enum(['PENDING', 'PREPARED', 'SIGNED', 'SUBMITTED', 'PAID', 'OVERDUE']),
  autonomyLevel: z.enum(['A0', 'A1', 'A2', 'A3']),
});

const obligationsFileSchema = z.object({ obligations: z.array(obligationSchema) });

const accountFileSchema = z.object({
  surRiskCategory: z.enum(['НИЗКАЯ', 'СРЕДНЯЯ', 'ВЫСОКАЯ']),
  balances: z.array(z.object({ taxType: z.string(), balance: z.string() })),
});

const noticesFileSchema = z.object({
  notices: z.array(
    z.object({
      id: z.string(),
      receivedAt: z.string(),
      description: z.string(),
      respondedAt: z.string().nullable(),
      textFile: z.string(),
    }),
  ),
});

/** Fixture-адаптер кабинета налогоплательщика. */
export class FixtureTaxCabinetAdapter implements TaxCabinetPort {
  private submissions = 0;

  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  private read<T>(file: string, schema: z.ZodType<T>): Result<T, PortError> {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.fixturesRoot, 'tax-cabinet', file), 'utf8'));
      return ok(schema.parse(raw));
    } catch (e) {
      return err({ kind: 'PARSE', message: `${file}: ${String(e)}` });
    }
  }

  async listObligations(_bin: Bin): Promise<Result<readonly TaxObligation[], PortError>> {
    const file = this.read('obligations.json', obligationsFileSchema);
    if (!file.ok) return file;
    const obligations: TaxObligation[] = [];
    for (const o of file.value.obligations) {
      const period = TaxPeriod.parse(o.period);
      const dueDate = LocalDate.parse(o.dueDate);
      if (!period.ok || !dueDate.ok) {
        return err({ kind: 'PARSE', message: `обязательство ${o.id}: период/срок` });
      }
      let amount = null;
      if (o.amount !== null) {
        const parsed = parseDecimalTenge(o.amount);
        if (!parsed.ok) return err({ kind: 'PARSE', message: `обязательство ${o.id}: сумма` });
        amount = parsed.value;
      }
      obligations.push({
        id: o.id,
        companyId: 'demo',
        kind: o.kind,
        period: period.value,
        dueDate: dueDate.value,
        amount,
        status: o.status,
        autonomyLevel: o.autonomyLevel,
      });
    }
    return ok(obligations);
  }

  async ledgerBalances(_bin: Bin): Promise<Result<readonly LedgerBalance[], PortError>> {
    const file = this.read('account.json', accountFileSchema);
    if (!file.ok) return file;
    const balances: LedgerBalance[] = [];
    for (const b of file.value.balances) {
      const parsed = parseDecimalTenge(b.balance);
      if (!parsed.ok) return err({ kind: 'PARSE', message: `сальдо ${b.taxType}` });
      balances.push({ taxType: b.taxType, balance: parsed.value });
    }
    return ok(balances);
  }

  async listNotices(_bin: Bin): Promise<Result<readonly TaxNotice[], PortError>> {
    let file: Result<z.infer<typeof noticesFileSchema>, PortError>;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.fixturesRoot, 'kgd', 'notices.json'), 'utf8'));
      file = ok(noticesFileSchema.parse(raw));
    } catch (e) {
      return err({ kind: 'PARSE', message: `kgd/notices.json: ${String(e)}` });
    }
    return ok(
      file.value.notices.map((n) => ({
        id: n.id,
        receivedAt: unwrap(LocalDate.parse(n.receivedAt)),
        description: n.description,
        respondedAt: n.respondedAt === null ? null : unwrap(LocalDate.parse(n.respondedAt)),
      })),
    );
  }

  /** Полный текст уведомления — сырьё для NoticeInterpreter (фаза 9). */
  noticeText(textFile: string): Result<string, PortError> {
    try {
      return ok(fs.readFileSync(path.join(this.fixturesRoot, 'kgd', textFile), 'utf8'));
    } catch (e) {
      return err({ kind: 'IO', message: String(e) });
    }
  }

  async surRiskCategory(_bin: Bin): Promise<Result<SurRiskCategory, PortError>> {
    const file = this.read('account.json', accountFileSchema);
    if (!file.ok) return file;
    return ok(file.value.surRiskCategory);
  }

  async submitFno(
    fno: PreparedFno,
    signature: SignatureArtifact,
  ): Promise<Result<FnoReceipt, PortError>> {
    if (signature.cmsBase64.trim() === '') {
      return err({ kind: 'VALIDATION', message: 'пустой артефакт подписи' });
    }
    this.submissions += 1;
    return ok({
      submissionId: `SUB-${fno.formCode}-${fno.period.code()}-${this.submissions}`,
      acceptedAtIso: `${signature.signedAtIso}`,
    });
  }
}
