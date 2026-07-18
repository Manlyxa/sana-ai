import { describe, expect, it } from 'vitest';
import { LocalDate, unwrap } from '@sana/domain';
import { FixtureBankAdapter, DEMO_IBAN } from '@sana/adapters';
import { BANK_CATALOG, BankDirectory, emptyBankPort } from './bank-directory';

const D = (iso: string) => unwrap(LocalDate.parse(iso));

function directory(): BankDirectory {
  return new BankDirectory(BANK_CATALOG, {
    id: 'kaspi',
    iban: DEMO_IBAN,
    port: new FixtureBankAdapter(),
    at: D('2026-01-10'),
  });
}

describe('BankDirectory (§13)', () => {
  it('стартует с одним подключённым источником и остальными доступными', () => {
    const dir = directory();
    const list = dir.list();
    expect(list).toHaveLength(BANK_CATALOG.length);
    expect(list.filter((b) => b.status === 'CONNECTED')).toHaveLength(1);
    expect(dir.connectedSources()).toHaveLength(1);
  });

  it('«подключить банк» создаёт запись источника и включает его в выписки', () => {
    const dir = directory();
    const halyk = unwrap(
      dir.connect('halyk', { iban: 'KZ00HALYKDEMO000001', port: emptyBankPort(), at: D('2026-07-01') }),
    );
    expect(halyk.status).toBe('CONNECTED');
    expect(halyk.connectedAt?.toISO()).toBe('2026-07-01');
    expect(dir.connectedSources()).toHaveLength(2);
  });

  it('повторное подключение и неизвестный банк — ошибки', () => {
    const dir = directory();
    expect(dir.connect('kaspi', { iban: 'x', port: emptyBankPort(), at: D('2026-07-01') }).ok).toBe(false);
    expect(dir.connect('tinkoff', { iban: 'x', port: emptyBankPort(), at: D('2026-07-01') }).ok).toBe(false);
  });

  it('выписка подключённого источника читается через его порт', async () => {
    const dir = directory();
    const source = dir.connectedSources()[0]!;
    const statement = await source.port.getStatement(source.iban, {
      from: D('2026-01-01'),
      to: D('2026-12-31'),
    });
    expect(statement.ok).toBe(true);
    if (statement.ok) expect(statement.value.length).toBeGreaterThan(0);
  });
});
