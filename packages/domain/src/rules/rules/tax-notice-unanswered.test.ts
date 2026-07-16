import { describe, expect, it } from 'vitest';
import { taxNoticeUnanswered } from './tax-notice-unanswered';
import { addWorkingDays } from '../../kernel/local-date';
import { D, testRuleContext } from '../../testing/fixtures';
import type { TaxNotice } from '../context';

const notice: TaxNotice = {
  id: 'ntc-1',
  receivedAt: D('2026-02-02'), // понедельник
  description: 'Расхождения по НДС за 4 кв. 2025',
  respondedAt: null,
};

// 30 рабочих дней без праздников
const deadline = addWorkingDays(notice.receivedAt, 30);

describe('TAX_NOTICE_UNANSWERED (30 рабочих дней → блокировка счетов)', () => {
  it('СРАБАТЫВАЕТ: до срока ≤ 14 дней', () => {
    const ctx = testRuleContext({ taxNotices: [notice] });
    const findings = taxNoticeUnanswered.evaluate(ctx, deadline.minusDays(10));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('CRITICAL');
    expect(findings[0]?.exposure.isZero()).toBe(true); // риск — блокировка, не сумма
    expect(findings[0]?.message).toContain(deadline.toISO());
    expect(findings[0]?.remediation.autonomyLevel).toBe('A1');
  });

  it('СРАБАТЫВАЕТ: срок прошёл — сообщение о возможной блокировке', () => {
    const ctx = testRuleContext({ taxNotices: [notice] });
    const findings = taxNoticeUnanswered.evaluate(ctx, deadline.plusDays(1));
    expect(findings[0]?.message).toContain('не исполнено');
  });

  it('НЕ СРАБАТЫВАЕТ: до срока далеко или ответ отправлен', () => {
    const ctx = testRuleContext({ taxNotices: [notice] });
    expect(taxNoticeUnanswered.evaluate(ctx, deadline.minusDays(20))).toEqual([]);
    const answered = testRuleContext({ taxNotices: [{ ...notice, respondedAt: D('2026-02-20') }] });
    expect(taxNoticeUnanswered.evaluate(answered, deadline.plusDays(5))).toEqual([]);
  });

  it('праздники сдвигают срок', () => {
    const holidays = new Set(['2026-03-09']); // праздник-понедельник внутри окна
    const shifted = addWorkingDays(notice.receivedAt, 30, holidays);
    expect(shifted.isAfter(deadline)).toBe(true);
    const ctx = testRuleContext({
      taxNotices: [notice],
      law: { ...testRuleContext().law, holidays },
    });
    const findings = taxNoticeUnanswered.evaluate(ctx, shifted.minusDays(1));
    expect(findings[0]?.message).toContain(shifted.toISO());
  });
});
