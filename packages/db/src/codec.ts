import { z } from 'zod';
import {
  Bin,
  createBusinessEvent,
  createEmployee,
  createInvoice,
  createJustification,
  err,
  Iin,
  LocalDate,
  Money,
  ok,
  Rate,
  unwrap,
  type BusinessEvent,
  type CurrencyCode,
  type Employee,
  type Finding,
  type Invoice,
  type Result,
} from '@sana/domain';

/**
 * Кодеки домен ↔ JSON(B). Сериализация — штатные toJSON доменных объектов;
 * десериализация — строгие zod-схемы, восстанавливающие объекты через
 * валидирующие фабрики домена. Невалидная строка БД — ошибка, не мусор.
 */

export class CodecError extends Error {}

function fail(message: string): never {
  throw new CodecError(message);
}

function fromResult<T, E>(r: Result<T, E>, what: string): T {
  if (!r.ok) fail(`${what}: ${JSON.stringify(r.error)}`);
  return r.value;
}

// --- примитивы -------------------------------------------------------------

const currencySchema = z.enum(['KZT', 'USD', 'EUR', 'RUB', 'CNY']);

export const moneySchema = z
  .object({ amount: z.string().regex(/^-?\d+$/), currency: currencySchema })
  .transform((raw) => Money.ofMinor(BigInt(raw.amount), raw.currency));

export const localDateSchema = z
  .string()
  .transform((iso) => fromResult(LocalDate.parse(iso), `дата «${iso}»`));

export const rateSchema = z
  .string()
  .regex(/^\d+(\.\d+)?%$/)
  .transform((text) => Rate.percent(text.slice(0, -1)));

export const binSchema = z.string().transform((v) => fromResult(Bin.parse(v), `БИН «${v}»`));
export const iinSchema = z.string().transform((v) => fromResult(Iin.parse(v), `ИИН «${v}»`));

export function moneyToRow(m: Money): { amountTiyn: bigint; currency: CurrencyCode } {
  return { amountTiyn: m.amount, currency: m.currency };
}

export function moneyFromRow(amountTiyn: bigint, currency: string): Money {
  return Money.ofMinor(amountTiyn, currencySchema.parse(currency));
}

// --- счёт-фактура и работник -------------------------------------------------

const invoiceLineSchema = z
  .object({
    description: z.string(),
    quantity: z.string().optional(),
    total: moneySchema,
    vatRate: rateSchema,
    vatAmount: moneySchema,
  })
  .transform(({ quantity, ...rest }) => (quantity === undefined ? rest : { ...rest, quantity }));

export const invoiceSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    direction: z.enum(['OUT', 'IN']),
    turnoverDate: localDateSchema,
    issueDate: localDateSchema.nullable(),
    counterpartyBin: binSchema,
    counterpartyName: z.string(),
    lines: z.array(invoiceLineSchema),
    totalExVat: moneySchema,
    vatAmount: moneySchema,
    status: z.enum(['ЧЕРНОВИК', 'ВЫСТАВЛЕН', 'ПОДТВЕРЖДЁН', 'ОТКЛОНЁН', 'ОТОЗВАН', 'АННУЛИРОВАН']),
    confirmedByRecipientAt: localDateSchema.nullable(),
    vatCreditNoticeSentAt: localDateSchema.nullable(),
  })
  .transform((raw): Invoice => fromResult(createInvoice(raw), `ЭСФ ${raw.number}`));

export const employeeSchema = z
  .object({
    iin: iinSchema,
    fullName: z.string(),
    birthDate: localDateSchema,
    hiredAt: localDateSchema,
    terminatedAt: localDateSchema.nullable(),
    residency: z.enum(['РЕЗИДЕНТ_РК', 'ЕАЭС', 'ИНОСТРАНЕЦ']),
    pensionerByAge: z.boolean(),
    disability: z
      .object({ group: z.enum(['I', 'II', 'III']), indefinite: z.boolean() })
      .nullable(),
    fullTimeStudent: z.boolean(),
    ipnDeductionApplicationAt: localDateSchema.nullable(),
    esutdRegisteredAt: localDateSchema.nullable(),
  })
  .transform((raw): Employee => fromResult(createEmployee(raw), `работник ${raw.fullName}`));

// --- события теневого регистра ----------------------------------------------

const payloadSchemas = {
  ESF_ISSUED: z.object({ invoice: invoiceSchema }),
  ESF_RECEIVED: z.object({ invoice: invoiceSchema }),
  ESF_STATUS_CHANGED: z.object({
    invoiceId: z.string(),
    from: z.enum(['ЧЕРНОВИК', 'ВЫСТАВЛЕН', 'ПОДТВЕРЖДЁН', 'ОТКЛОНЁН', 'ОТОЗВАН', 'АННУЛИРОВАН']),
    to: z.enum(['ЧЕРНОВИК', 'ВЫСТАВЛЕН', 'ПОДТВЕРЖДЁН', 'ОТКЛОНЁН', 'ОТОЗВАН', 'АННУЛИРОВАН']),
  }),
  BANK_TRANSACTION: z.object({
    direction: z.enum(['CREDIT', 'DEBIT']),
    amount: moneySchema,
    counterpartyBin: binSchema.nullable(),
    counterpartyName: z.string().nullable(),
    purposeText: z.string(),
    knp: z.string().nullable(),
  }),
  EMPLOYEE_HIRED: z.object({ employee: employeeSchema }),
  EMPLOYEE_TERMINATED: z.object({ iin: iinSchema, terminatedAt: localDateSchema }),
} as const;

const eventTypeSchema = z.enum([
  'ESF_ISSUED',
  'ESF_RECEIVED',
  'ESF_STATUS_CHANGED',
  'BANK_TRANSACTION',
  'EMPLOYEE_HIRED',
  'EMPLOYEE_TERMINATED',
]);

const sourceSystemSchema = z.enum(['ИС_ЭСФ', 'КНП', 'БАНК', 'ОФД', 'ЕСУТД', '1С', 'РУЧНОЙ_ВВОД', 'SANA']);

const docRefSchema = z
  .object({
    system: z.string(),
    documentType: z.string(),
    documentId: z.string(),
    description: z.string().optional(),
  })
  .transform(({ description, ...rest }) =>
    description === undefined ? rest : { ...rest, description },
  );

/** Доменный объект → plain JSON для jsonb (через toJSON доменных типов). */
export function toJsonb(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export type BusinessEventRow = {
  id: string;
  companyId: string;
  occurredAt: string;
  type: string;
  payload: unknown;
  sourceSystem: string;
  sourceDocumentRef: unknown;
  ingestedAt: string;
};

export function deserializeEvent(row: BusinessEventRow): Result<BusinessEvent, string> {
  try {
    const type = eventTypeSchema.parse(row.type);
    const payload = payloadSchemas[type].parse(row.payload);
    const event = createBusinessEvent({
      id: row.id,
      companyId: row.companyId,
      occurredAt: fromResult(LocalDate.parse(row.occurredAt), 'occurredAt'),
      type,
      payload,
      sourceSystem: sourceSystemSchema.parse(row.sourceSystem),
      sourceDocumentRef:
        row.sourceDocumentRef === null ? null : docRefSchema.parse(row.sourceDocumentRef),
      ingestedAt: fromResult(LocalDate.parse(row.ingestedAt), 'ingestedAt'),
    } as BusinessEvent);
    return event.ok ? ok(event.value) : err(event.error.message);
  } catch (e) {
    return err(`событие ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// --- находки -----------------------------------------------------------------

const remediationSchema = z.object({
  kind: z.string(),
  description: z.string(),
  autonomyLevel: z.enum(['A0', 'A1', 'A2', 'A3']),
});

const justificationSchema = z.object({
  norm: z.string(),
  sourceDocuments: z.array(docRefSchema),
  parameterVersion: z.string(),
  explanation: z.string(),
});

export type FindingRow = {
  id: string;
  ruleId: string;
  companyId: string;
  severity: string;
  asOf: string;
  exposureTiyn: bigint;
  currency: string;
  message: string;
  justification: unknown;
  remediation: unknown;
};

export function deserializeFinding(row: FindingRow): Result<Finding, string> {
  try {
    const justification = justificationSchema.parse(row.justification);
    return ok({
      id: row.id,
      ruleId: row.ruleId,
      companyId: row.companyId,
      severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'INFO']).parse(row.severity),
      asOf: fromResult(LocalDate.parse(row.asOf), 'asOf'),
      exposure: moneyFromRow(row.exposureTiyn, row.currency),
      message: row.message,
      justification: unwrap(createJustification(justification)),
      remediation: remediationSchema.parse(row.remediation),
    });
  } catch (e) {
    return err(`находка ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
