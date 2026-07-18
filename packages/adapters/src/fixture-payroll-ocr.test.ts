import { describe, expect, it } from 'vitest';
import { Bin, unwrap } from '@sana/domain';
import { FixtureOcrAdapter } from './fixture-ocr-adapter';
import { FixturePayrollAdapter } from './fixture-payroll-adapter';

const COMPANY_BIN = unwrap(Bin.parse('120540000001'));

describe('FixturePayrollAdapter (§6)', () => {
  it('читает ведомость 2026 года: 7 сотрудников с помесячными начислениями', async () => {
    const result = await new FixturePayrollAdapter().listSalaries(COMPANY_BIN, 2026);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(7);
    const accountant = result.value.find((s) => s.position === 'Бухгалтер')!;
    expect(accountant.grossByMonth.get(7)?.toDecimalString()).toBe('250000.00');
    expect(accountant.ipnDeductionApplicationAt?.toISO()).toBe('2026-01-05');
    const raised = result.value.find((s) => s.iin.value === '950128300003')!;
    expect(raised.grossByMonth.get(1)?.toDecimalString()).toBe('150000.00');
    expect(raised.grossByMonth.get(7)?.toDecimalString()).toBe('200000.00');
  });

  it('отсутствующий год — NOT_FOUND, а не пустой список', async () => {
    const result = await new FixturePayrollAdapter().listSalaries(COMPANY_BIN, 2031);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NOT_FOUND');
  });

  it('битый каталог фикстур — ошибка PARSE', async () => {
    const result = await new FixturePayrollAdapter('/nonexistent').listSalaries(COMPANY_BIN, 2026);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('PARSE');
  });
});

describe('FixtureOcrAdapter (§8)', () => {
  it('распознаёт документ по ключевому слову в имени файла', async () => {
    const result = await new FixtureOcrAdapter().recognize('скан-акт-№12.pdf');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Акт выполненных работ №12');
    expect(result.value.amount.toDecimalString()).toBe('180000.00');
    expect(result.value.confidence).toBe(67);
    expect(result.value.creditAccount).toBe('3310');
  });

  it('незнакомый файл — NOT_FOUND с человеческим сообщением', async () => {
    const result = await new FixtureOcrAdapter().recognize('фото-кота.jpg');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('NOT_FOUND');
      expect(result.error.message).toContain('не распознан');
    }
  });

  it('битый каталог фикстур — ошибка PARSE', async () => {
    const result = await new FixtureOcrAdapter('/nonexistent').recognize('акт.pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('PARSE');
  });
});
