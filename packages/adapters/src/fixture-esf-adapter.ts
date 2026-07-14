import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  Bin,
  createInvoice,
  err,
  LocalDate,
  markVatCreditNoticeSent,
  ok,
  Rate,
  transitionInvoice,
  unwrap,
  type Invoice,
  type InvoiceDirection,
  type InvoiceLine,
  type InvoiceStatus,
  type Result,
} from '@sana/domain';
import type { DateRange, EsfPort, PortError } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';
import { parseDecimalTenge, parseIsoDate, xmlTag, xmlTags } from './parse';

/** Статусы ИС ЭСФ → доменные статусы. */
const STATUS_MAP: Record<string, InvoiceStatus> = {
  DRAFT: 'ЧЕРНОВИК',
  CREATED: 'ВЫСТАВЛЕН',
  DELIVERED: 'ВЫСТАВЛЕН',
  CONFIRMED_BY_CUSTOMER: 'ПОДТВЕРЖДЁН',
  DECLINED: 'ОТКЛОНЁН',
  REVOKED: 'ОТОЗВАН',
  CANCELED: 'АННУЛИРОВАН',
};

const noticesSchema = z.object({ notices: z.record(z.string(), z.string()) });

function parseError(message: string): PortError {
  return { kind: 'PARSE', message };
}

/**
 * Fixture-адаптер ИС ЭСФ: читает канонические XML из /fixtures/esf.
 * Операции мутируют только память — детерминированно для тестов и dev.
 */
export class FixtureEsfAdapter implements EsfPort {
  private invoices: Invoice[] | null = null;

  constructor(
    private readonly fixturesRoot: string = defaultFixturesRoot(),
    /** «Сегодня» для операций — детерминированные даты (P1). */
    private readonly today: LocalDate = unwrap(LocalDate.parse('2026-05-10')),
  ) {}

  private load(): Result<Invoice[], PortError> {
    if (this.invoices !== null) return ok(this.invoices);
    const dir = path.join(this.fixturesRoot, 'esf');
    try {
      const noticesRaw = noticesSchema.parse(
        JSON.parse(fs.readFileSync(path.join(dir, 'vat-credit-notices.json'), 'utf8')),
      );
      const invoices: Invoice[] = [];
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
        const parsed = this.parseInvoiceXml(
          fs.readFileSync(path.join(dir, file), 'utf8'),
          noticesRaw.notices,
        );
        if (!parsed.ok) return err(parseError(`${file}: ${parsed.error.message}`));
        invoices.push(parsed.value);
      }
      this.invoices = invoices;
      return ok(invoices);
    } catch (e) {
      return err({ kind: 'IO', message: `чтение фикстур ЭСФ: ${String(e)}` });
    }
  }

  private parseInvoiceXml(
    xml: string,
    notices: Record<string, string>,
  ): Result<Invoice, PortError> {
    const need = (tag: string): string => {
      const v = xmlTag(xml, tag);
      if (v === null) throw new Error(`нет тега <${tag}>`);
      return v;
    };
    try {
      const number = need('registrationNumber');
      const statusRaw = need('status');
      const status = STATUS_MAP[statusRaw];
      if (status === undefined) throw new Error(`неизвестный статус ИС ЭСФ: ${statusRaw}`);

      const seller = need('seller');
      const customer = need('customer');
      const sellerBin = unwrapOrThrow(Bin.parse(xmlTag(seller, 'tin') ?? ''), 'seller.tin');
      const customerBin = unwrapOrThrow(Bin.parse(xmlTag(customer, 'tin') ?? ''), 'customer.tin');

      const lines: InvoiceLine[] = xmlTags(xml, 'invoiceLine').map((lineXml, i) => {
        const total = unwrapOrThrow(parseDecimalTenge(xmlTag(lineXml, 'priceWithoutTax') ?? ''), `line ${i}: priceWithoutTax`);
        const vatAmount = unwrapOrThrow(parseDecimalTenge(xmlTag(lineXml, 'ndsAmount') ?? ''), `line ${i}: ndsAmount`);
        const line: InvoiceLine = {
          description: xmlTag(lineXml, 'description') ?? '',
          total,
          vatRate: Rate.percent(xmlTag(lineXml, 'ndsRate') ?? '0'),
          vatAmount,
        };
        const quantity = xmlTag(lineXml, 'quantity');
        return quantity === null ? line : { ...line, quantity };
      });

      const issueDateRaw = xmlTag(xml, 'date');
      const confirmedRaw = xmlTag(xml, 'confirmedDate');
      const noticeRaw = notices[number];

      // Направление зависит от компании-владельца — храним обе стороны и
      // решаем в listInvoices; здесь фиксируем стороны документа.
      const invoice = createInvoice({
        id: number,
        number,
        direction: 'OUT', // переопределяется относительно компании в listInvoices
        turnoverDate: unwrapOrThrow(parseIsoDate(need('turnoverDate')), 'turnoverDate'),
        issueDate: issueDateRaw === null ? null : unwrapOrThrow(parseIsoDate(issueDateRaw), 'date'),
        counterpartyBin: customerBin,
        counterpartyName: xmlTag(customer, 'name') ?? '',
        lines,
        totalExVat: unwrapOrThrow(parseDecimalTenge(need('totalPriceWithoutTax')), 'totalPriceWithoutTax'),
        vatAmount: unwrapOrThrow(parseDecimalTenge(need('totalNdsAmount')), 'totalNdsAmount'),
        status,
        confirmedByRecipientAt:
          confirmedRaw === null ? null : unwrapOrThrow(parseIsoDate(confirmedRaw), 'confirmedDate'),
        vatCreditNoticeSentAt: null,
      });
      if (!invoice.ok) throw new Error(invoice.error.map((e) => `${e.field}: ${e.message}`).join('; '));

      // Приложим стороны через приватные поля разбора: seller хранится в id-контексте.
      const withSides: ParsedInvoice = {
        ...invoice.value,
        sellerBin,
        sellerName: xmlTag(seller, 'name') ?? '',
        customerBin,
        customerName: xmlTag(customer, 'name') ?? '',
        noticeSentAtIso: noticeRaw ?? null,
      };
      return ok(withSides);
    } catch (e) {
      return err(parseError(e instanceof Error ? e.message : String(e)));
    }
  }

  async listInvoices(
    companyBin: Bin,
    range: DateRange,
    direction?: InvoiceDirection,
  ): Promise<Result<readonly Invoice[], PortError>> {
    const loaded = this.load();
    if (!loaded.ok) return loaded;
    const result: Invoice[] = [];
    for (const raw of loaded.value as ParsedInvoice[]) {
      const isOut = raw.sellerBin.equals(companyBin);
      const isIn = raw.customerBin.equals(companyBin);
      if (!isOut && !isIn) continue;
      const dir: InvoiceDirection = isOut ? 'OUT' : 'IN';
      if (direction !== undefined && dir !== direction) continue;
      if (!raw.turnoverDate.isWithin(range.from, range.to)) continue;
      const counterpartyBin = isOut ? raw.customerBin : raw.sellerBin;
      const counterpartyName = isOut ? raw.customerName : raw.sellerName;
      // Извещение: из реестра извещений или проставленное операцией sendVatCreditNotice.
      const notice =
        dir !== 'IN'
          ? null
          : raw.vatCreditNoticeSentAt ??
            (raw.noticeSentAtIso !== null ? unwrap(LocalDate.parse(raw.noticeSentAtIso)) : null);
      result.push({
        ...stripParseFields(raw),
        direction: dir,
        counterpartyBin,
        counterpartyName,
        vatCreditNoticeSentAt: notice,
      });
    }
    return ok(result);
  }

  private mutate(
    invoiceId: string,
    fn: (invoice: Invoice) => Result<Invoice, { message: string }>,
  ): Promise<Result<Invoice, PortError>> {
    const loaded = this.load();
    if (!loaded.ok) return Promise.resolve(loaded);
    const idx = loaded.value.findIndex((i) => i.id === invoiceId);
    const current = loaded.value[idx];
    if (current === undefined) {
      return Promise.resolve(err({ kind: 'NOT_FOUND', message: `ЭСФ ${invoiceId} не найден` }));
    }
    const updated = fn(current);
    if (!updated.ok) {
      return Promise.resolve(err({ kind: 'VALIDATION', message: updated.error.message }));
    }
    loaded.value[idx] = { ...current, ...updated.value };
    return Promise.resolve(ok(loaded.value[idx] as Invoice));
  }

  async issueInvoice(draft: Invoice): Promise<Result<Invoice, PortError>> {
    return this.mutate(draft.id, (inv) =>
      transitionInvoice(inv, 'ВЫСТАВЛЕН', this.today),
    );
  }

  async confirmInvoice(invoiceId: string): Promise<Result<Invoice, PortError>> {
    return this.mutate(invoiceId, (inv) => transitionInvoice(inv, 'ПОДТВЕРЖДЁН', this.today));
  }

  async rejectInvoice(invoiceId: string, _reason: string): Promise<Result<Invoice, PortError>> {
    return this.mutate(invoiceId, (inv) => transitionInvoice(inv, 'ОТКЛОНЁН', this.today));
  }

  async sendVatCreditNotice(invoiceId: string): Promise<Result<Invoice, PortError>> {
    return this.mutate(invoiceId, (inv) => {
      const asIncoming: Invoice = { ...inv, direction: 'IN' };
      return markVatCreditNoticeSent(asIncoming, this.today);
    });
  }
}

type ParsedInvoice = Invoice & {
  readonly sellerBin: Bin;
  readonly sellerName: string;
  readonly customerBin: Bin;
  readonly customerName: string;
  readonly noticeSentAtIso: string | null;
};

function stripParseFields(raw: ParsedInvoice): Invoice {
  const { sellerBin: _s, sellerName: _sn, customerBin: _c, customerName: _cn, noticeSentAtIso: _n, ...invoice } = raw;
  return invoice;
}

function unwrapOrThrow<T, E>(r: Result<T, E>, what: string): T {
  if (r.ok) return r.value;
  throw new Error(`${what}: ${JSON.stringify(r.error)}`);
}
