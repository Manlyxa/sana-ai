import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Bin, err, LocalDate, Money, ok, TaxPeriod, unwrap } from '@sana/domain';
import type { LlmSchema } from '@sana/ports';
import { FixtureBankAdapter, DEMO_IBAN } from './fixture-bank-adapter';
import { FixtureTaxCabinetAdapter } from './fixture-tax-cabinet-adapter';
import { FixtureEnbekAdapter } from './fixture-enbek-adapter';
import { FixtureCounterpartyRegistryAdapter } from './fixture-counterparty-registry-adapter';
import { FixtureOfdAdapter } from './fixture-ofd-adapter';
import { MockSignatureProvider } from './mock-signature-provider';
import { MockLlmAdapter } from './mock-llm-adapter';
import { parseDecimalTenge } from './parse';

const COMPANY = unwrap(Bin.parse('120540000001'));
const D = (iso: string) => unwrap(LocalDate.parse(iso));
const YEAR = { from: D('2026-01-01'), to: D('2026-12-31') };

describe('parseDecimalTenge', () => {
  it('разбирает суммы без плавающей точки', () => {
    expect(unwrap(parseDecimalTenge('3500000.00')).equals(Money.ofMajor(3_500_000))).toBe(true);
    expect(unwrap(parseDecimalTenge('0.05')).amount).toBe(5n);
    expect(unwrap(parseDecimalTenge('-910000.00')).equals(Money.ofMajor(-910_000))).toBe(true);
    expect(unwrap(parseDecimalTenge('12.5')).amount).toBe(1250n);
    expect(parseDecimalTenge('12,50').ok).toBe(false);
    expect(parseDecimalTenge('abc').ok).toBe(false);
  });
});

describe('FixtureBankAdapter', () => {
  it('читает нормализованный CSV: направления, суммы, БИН/КНП', async () => {
    const lines = unwrap(await new FixtureBankAdapter().getStatement(DEMO_IBAN, YEAR));
    expect(lines).toHaveLength(8);
    const first = lines[0]!;
    expect(first.direction).toBe('CREDIT');
    expect(first.amount.equals(Money.ofMajor(4_060_000))).toBe(true);
    expect(first.counterpartyBin?.value).toBe('201140000007');
    const salary = lines.find((l) => l.id === 'BT-0006')!;
    expect(salary.counterpartyBin).toBeNull();
    expect(salary.knp).toBe('112');
  });

  it('фильтрует по периоду и счёту', async () => {
    const feb = unwrap(
      await new FixtureBankAdapter().getStatement(DEMO_IBAN, { from: D('2026-02-01'), to: D('2026-02-28') }),
    );
    expect(feb.map((l) => l.id)).toEqual(['BT-0001', 'BT-0002']);
    const other = unwrap(await new FixtureBankAdapter().getStatement('KZ00000000000000000', YEAR));
    expect(other).toEqual([]);
  });
});

describe('FixtureTaxCabinetAdapter', () => {
  const adapter = new FixtureTaxCabinetAdapter();

  it('обязательства с периодами и суммами', async () => {
    const obligations = unwrap(await adapter.listObligations(COMPANY));
    expect(obligations).toHaveLength(3);
    const fno300 = obligations.find((o) => o.id === 'OBL-2026-300-Q1')!;
    expect(fno300.period.equals(TaxPeriod.quarter(2026, 1))).toBe(true);
    expect(fno300.amount?.equals(Money.ofMajor(2_340_000))).toBe(true);
    expect(obligations.find((o) => o.id === 'OBL-2026-200-Q1')?.amount).toBeNull();
  });

  it('уведомления КГД и полный текст', async () => {
    const notices = unwrap(await adapter.listNotices(COMPANY));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.respondedAt).toBeNull();
    expect(notices[0]?.receivedAt.toISO()).toBe('2026-03-20');
    const text = unwrap(adapter.noticeText('uvedomlenie-001.txt'));
    expect(text).toContain('УВЕДОМЛЕНИЕ');
    expect(text).toContain('30 (тридцати) рабочих дней');
  });

  it('СУР и лицевой счёт', async () => {
    expect(unwrap(await adapter.surRiskCategory(COMPANY))).toBe('СРЕДНЯЯ');
    const balances = unwrap(await adapter.ledgerBalances(COMPANY));
    expect(balances.find((b) => b.taxType.includes('НДС'))?.balance.isNegative()).toBe(true);
  });

  it('submitFno принимает только подписанный документ (тип требует артефакт)', async () => {
    const receipt = unwrap(
      await adapter.submitFno(
        { formCode: '300.00', period: TaxPeriod.quarter(2026, 1), payloadXml: '<fno/>' },
        { requestId: 'r1', documentId: 'd1', cmsBase64: 'TU9DSw==', signedAtIso: '2026-05-11T10:00:00+05:00' },
      ),
    );
    expect(receipt.submissionId).toContain('300.00');
    const empty = await adapter.submitFno(
      { formCode: '300.00', period: TaxPeriod.quarter(2026, 1), payloadXml: '<fno/>' },
      { requestId: 'r2', documentId: 'd2', cmsBase64: ' ', signedAtIso: '' },
    );
    expect(empty.ok).toBe(false);
  });
});

describe('FixtureEnbekAdapter', () => {
  it('12 договоров, один не зарегистрирован в ЕСУТД', async () => {
    const contracts = unwrap(await new FixtureEnbekAdapter().listContracts(COMPANY));
    expect(contracts).toHaveLength(12);
    const unregistered = contracts.filter((c) => c.registeredAt === null);
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0]?.iin.value).toBe('751105300009');
    expect(unregistered[0]?.hiredAt.toISO()).toBe('2026-03-02');
  });
});

describe('FixtureCounterpartyRegistryAdapter', () => {
  const adapter = new FixtureCounterpartyRegistryAdapter();

  it('находит контрагента с флагами риска', async () => {
    const lzhe = unwrap(await adapter.lookup(unwrap(Bin.parse('180240000001'))));
    expect(lzhe.riskFlags).toContain('LZHEPREDPRIYATIE');
    expect(lzhe.riskScore).toBe(96);
    const snr = unwrap(await adapter.lookup(unwrap(Bin.parse('210640000004'))));
    expect(snr.taxRegime).toBe('СНР_УПРОЩЁНКА');
  });

  it('NOT_FOUND для незнакомого БИН', async () => {
    const r = await adapter.lookup(unwrap(Bin.parse('090550000008')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('NOT_FOUND');
  });
});

describe('FixtureOfdAdapter', () => {
  it('чеки за период', async () => {
    const receipts = unwrap(await new FixtureOfdAdapter().listReceipts(COMPANY, YEAR));
    expect(receipts).toHaveLength(3);
    const q1 = unwrap(
      await new FixtureOfdAdapter().listReceipts(COMPANY, { from: D('2026-01-01'), to: D('2026-03-31') }),
    );
    expect(q1).toHaveLength(2);
  });
});

describe('MockSignatureProvider (P4)', () => {
  it('подписание асинхронно и проходит через человека; ключа нет нигде', async () => {
    const provider = new MockSignatureProvider();
    const signedEvents: string[] = [];
    provider.onSigned((a) => signedEvents.push(a.requestId));

    const request = unwrap(
      await provider.requestSignature({
        id: 'fno-300-q1',
        title: 'ФНО 300.00 за 1 кв. 2026',
        contentHash: 'abc123',
        contentBase64: 'PGZubz4=',
      }),
    );
    expect(request.status).toBe('PENDING');
    expect(unwrap(await provider.getRequest(request.id)).artifact).toBeNull();

    const artifact = provider.signPending(request.id);
    expect(signedEvents).toEqual([request.id]);
    const after = unwrap(await provider.getRequest(request.id));
    expect(after.request.status).toBe('SIGNED');
    expect(after.artifact?.cmsBase64).toBe(artifact.cmsBase64);
    expect(() => provider.signPending(request.id)).toThrow(); // дважды нельзя
  });

  it('владелец может отклонить', async () => {
    const provider = new MockSignatureProvider();
    const request = unwrap(
      await provider.requestSignature({ id: 'd', title: 't', contentHash: 'h', contentBase64: '' }),
    );
    provider.declinePending(request.id);
    expect(unwrap(await provider.getRequest(request.id)).request.status).toBe('DECLINED');
    const missing = await provider.getRequest('нет');
    expect(missing.ok).toBe(false);
  });
});

describe('MockLlmAdapter (P1)', () => {
  const schema: LlmSchema<{ amount: number }> = {
    name: 'notice-extract',
    parse: (raw) => {
      const parsed = z.object({ amount: z.number() }).safeParse(raw);
      return parsed.success ? ok(parsed.data) : err(parsed.error.message);
    },
  };

  it('возвращает канонический ответ через строгую схему', async () => {
    const llm = new MockLlmAdapter({ 'notice-extract': { amount: 2_760_000 } });
    expect(unwrap(await llm.complete('...', schema)).amount).toBe(2_760_000);
  });

  it('ошибки: нет ответа / ответ не по схеме', async () => {
    expect((await new MockLlmAdapter({}).complete('...', schema)).ok).toBe(false);
    const bad = new MockLlmAdapter({ 'notice-extract': { amount: 'много' } });
    expect((await bad.complete('...', schema)).ok).toBe(false);
  });
});
