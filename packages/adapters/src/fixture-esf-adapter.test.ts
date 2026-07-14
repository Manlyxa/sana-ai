import { describe, expect, it } from 'vitest';
import { Bin, LocalDate, Money, unwrap } from '@sana/domain';
import { FixtureEsfAdapter } from './fixture-esf-adapter';

const COMPANY = unwrap(Bin.parse('120540000001'));
const D = (iso: string) => unwrap(LocalDate.parse(iso));
const YEAR = { from: D('2026-01-01'), to: D('2026-12-31') };

describe('FixtureEsfAdapter', () => {
  it('читает все ЭСФ компании из XML-фикстур', async () => {
    const adapter = new FixtureEsfAdapter();
    const invoices = unwrap(await adapter.listInvoices(COMPANY, YEAR));
    expect(invoices.map((i) => i.number).sort()).toEqual([
      'ESF-IN-2026-0001',
      'ESF-IN-2026-0002',
      'ESF-IN-2026-0003',
      'ESF-IN-2026-0004',
      'ESF-OUT-2026-0001',
      'ESF-OUT-2026-0002',
    ]);
  });

  it('направление определяется относительно компании; контрагент — другая сторона', async () => {
    const adapter = new FixtureEsfAdapter();
    const incoming = unwrap(await adapter.listInvoices(COMPANY, YEAR, 'IN'));
    expect(incoming).toHaveLength(4);
    const in1 = incoming.find((i) => i.number === 'ESF-IN-2026-0001')!;
    expect(in1.counterpartyBin.value).toBe('130840000004');
    expect(in1.counterpartyName).toContain('Караганда Металл');
    expect(in1.totalExVat.equals(Money.ofMajor(2_400_000))).toBe(true);
    expect(in1.vatAmount.equals(Money.ofMajor(384_000))).toBe(true);
  });

  it('статусы ИС ЭСФ отображаются в доменные', async () => {
    const adapter = new FixtureEsfAdapter();
    const all = unwrap(await adapter.listInvoices(COMPANY, YEAR));
    const byNumber = new Map(all.map((i) => [i.number, i]));
    expect(byNumber.get('ESF-OUT-2026-0001')?.status).toBe('ПОДТВЕРЖДЁН');
    expect(byNumber.get('ESF-OUT-2026-0002')?.status).toBe('ЧЕРНОВИК');
    expect(byNumber.get('ESF-IN-2026-0004')?.status).toBe('ВЫСТАВЛЕН');
    expect(byNumber.get('ESF-OUT-2026-0001')?.confirmedByRecipientAt?.toISO()).toBe('2026-02-16');
  });

  it('извещения о зачёте подтягиваются из реестра извещений', async () => {
    const adapter = new FixtureEsfAdapter();
    const incoming = unwrap(await adapter.listInvoices(COMPANY, YEAR, 'IN'));
    const withNotice = incoming.find((i) => i.number === 'ESF-IN-2026-0002')!;
    const withoutNotice = incoming.find((i) => i.number === 'ESF-IN-2026-0001')!;
    expect(withNotice.vatCreditNoticeSentAt?.toISO()).toBe('2026-03-15');
    expect(withoutNotice.vatCreditNoticeSentAt).toBeNull();
  });

  it('фильтр по периоду', async () => {
    const adapter = new FixtureEsfAdapter();
    const feb = unwrap(await adapter.listInvoices(COMPANY, { from: D('2026-02-01'), to: D('2026-02-28') }));
    expect(feb.map((i) => i.number).sort()).toEqual(['ESF-IN-2026-0001', 'ESF-OUT-2026-0001']);
  });

  it('операции: confirm и sendVatCreditNotice мутируют состояние в памяти', async () => {
    const adapter = new FixtureEsfAdapter();
    const confirmed = unwrap(await adapter.confirmInvoice('ESF-IN-2026-0004'));
    expect(confirmed.status).toBe('ПОДТВЕРЖДЁН');
    const noticed = unwrap(await adapter.sendVatCreditNotice('ESF-IN-2026-0001'));
    expect(noticed.vatCreditNoticeSentAt?.toISO()).toBe('2026-05-10');
    const missing = await adapter.confirmInvoice('нет-такого');
    expect(missing.ok).toBe(false);
    // недопустимый переход — VALIDATION
    const bad = await adapter.confirmInvoice('ESF-OUT-2026-0002'); // черновик
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe('VALIDATION');
  });

  it('чужие ЭСФ не возвращаются', async () => {
    const adapter = new FixtureEsfAdapter();
    const stranger = unwrap(Bin.parse('090550000008'));
    expect(unwrap(await adapter.listInvoices(stranger, YEAR))).toEqual([]);
  });
});
