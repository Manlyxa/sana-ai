import { describe, expect, it } from 'vitest';
import {
  createInvoice,
  grossTotal,
  INVOICE_TRANSITIONS,
  markVatCreditNoticeSent,
  transitionInvoice,
  type InvoiceStatus,
} from './invoice';
import { D, testInvoice } from '../testing/fixtures';
import { Money } from '../kernel/money';
import { Rate } from '../kernel/rate';
import { unwrap } from '../kernel/result';

describe('Invoice (ЭСФ)', () => {
  it('создаёт валидный ЭСФ; итоги равны суммам строк', () => {
    const inv = testInvoice();
    expect(inv.totalExVat.equals(Money.ofMajor(1_000_000))).toBe(true);
    expect(inv.vatAmount.equals(Money.ofMajor(160_000))).toBe(true);
    expect(grossTotal(inv).equals(Money.ofMajor(1_160_000))).toBe(true);
  });

  it('отвергает расхождение итогов со строками', () => {
    const inv = testInvoice();
    const r = createInvoice({ ...inv, totalExVat: Money.ofMajor(999_999) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.field).toBe('totalExVat');

    const r2 = createInvoice({ ...inv, vatAmount: Money.ofMajor(1) });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error[0]?.field).toBe('vatAmount');
  });

  it('отвергает пустые id/номер/строки и валютный разнобой', () => {
    const inv = testInvoice();
    expect(createInvoice({ ...inv, id: '' }).ok).toBe(false);
    expect(createInvoice({ ...inv, number: ' ' }).ok).toBe(false);
    expect(createInvoice({ ...inv, lines: [], totalExVat: Money.zero(), vatAmount: Money.zero() }).ok).toBe(false);
    const usdLine = {
      description: 'x',
      total: Money.ofMajor(1, 'USD'),
      vatRate: Rate.percent(0),
      vatAmount: Money.zero('USD'),
    };
    expect(createInvoice({ ...inv, lines: [usdLine] }).ok).toBe(false);
  });

  it('выставленный ЭСФ обязан иметь дату выписки; черновик — нет', () => {
    const inv = testInvoice();
    expect(createInvoice({ ...inv, issueDate: null }).ok).toBe(false);
    expect(createInvoice({ ...inv, status: 'ЧЕРНОВИК', issueDate: null }).ok).toBe(true);
  });

  it('жизненный цикл 2026: допустимые переходы', () => {
    const draft = testInvoice({ status: 'ЧЕРНОВИК', issueDate: null });
    const issued = unwrap(transitionInvoice(draft, 'ВЫСТАВЛЕН', D('2026-02-12')));
    expect(issued.status).toBe('ВЫСТАВЛЕН');
    expect(issued.issueDate?.toISO()).toBe('2026-02-12');

    const confirmed = unwrap(transitionInvoice(issued, 'ПОДТВЕРЖДЁН', D('2026-02-15')));
    expect(confirmed.confirmedByRecipientAt?.toISO()).toBe('2026-02-15');

    const annulled = unwrap(transitionInvoice(confirmed, 'АННУЛИРОВАН', D('2026-03-01')));
    expect(annulled.status).toBe('АННУЛИРОВАН');

    expect(transitionInvoice(issued, 'ОТКЛОНЁН', D('2026-02-15')).ok).toBe(true);
    expect(transitionInvoice(issued, 'ОТОЗВАН', D('2026-02-15')).ok).toBe(true);
  });

  it('жизненный цикл 2026: недопустимые переходы отвергаются', () => {
    const draft = testInvoice({ status: 'ЧЕРНОВИК', issueDate: null });
    const issued = testInvoice();
    const cases: Array<[typeof draft, InvoiceStatus]> = [
      [draft, 'ПОДТВЕРЖДЁН'], // черновик нельзя подтвердить
      [draft, 'АННУЛИРОВАН'],
      [testInvoice({ status: 'ОТОЗВАН' }), 'ВЫСТАВЛЕН'], // отозванный — терминальный
      [testInvoice({ status: 'АННУЛИРОВАН' }), 'ВЫСТАВЛЕН'],
      [issued, 'ЧЕРНОВИК'], // назад в черновик нельзя
    ];
    for (const [inv, to] of cases) {
      const r = transitionInvoice(inv, to, D('2026-03-01'));
      expect(r.ok, `${inv.status} → ${to}`).toBe(false);
    }
  });

  it('карта переходов покрывает все статусы', () => {
    expect(Object.keys(INVOICE_TRANSITIONS).sort()).toEqual(
      ['АННУЛИРОВАН', 'ВЫСТАВЛЕН', 'ОТКЛОНЁН', 'ОТОЗВАН', 'ПОДТВЕРЖДЁН', 'ЧЕРНОВИК'].sort(),
    );
  });

  it('извещение о зачёте — только входящие, один раз', () => {
    const outgoing = testInvoice();
    expect(markVatCreditNoticeSent(outgoing, D('2026-03-01')).ok).toBe(false);

    const incoming = testInvoice({ direction: 'IN' });
    const marked = unwrap(markVatCreditNoticeSent(incoming, D('2026-03-01')));
    expect(marked.vatCreditNoticeSentAt?.toISO()).toBe('2026-03-01');
    expect(markVatCreditNoticeSent(marked, D('2026-03-02')).ok).toBe(false);
  });

  it('vatCreditNoticeSentAt на исходящем ЭСФ — ошибка валидации', () => {
    const inv = testInvoice();
    expect(createInvoice({ ...inv, vatCreditNoticeSentAt: D('2026-03-01') }).ok).toBe(false);
  });
});
