import { describe, expect, it } from 'vitest';
import { LocalDate, unwrap } from '@sana/domain';
import { FixtureOcrAdapter } from '@sana/adapters';
import { AccountingWorkspace } from '../accounting/accounting-workspace';
import { intakeDocumentFile } from './document-intake';

const D = (iso: string) => unwrap(LocalDate.parse(iso));
const ocr = new FixtureOcrAdapter();

describe('документы через очередь подтверждения (§8)', () => {
  it('загруженный файл создаёт PENDING-запись в ТОЙ ЖЕ очереди, что и автопроводки', async () => {
    const ws = new AccountingWorkspace('demo-too');
    const result = unwrap(
      await intakeDocumentFile(ws, ocr, { fileName: 'такси-отчёт.jpg', today: D('2026-07-16') }),
    );
    expect(result.recognized.title).toBe('Авансовый отчёт — такси');
    expect(result.pending.status).toBe('PENDING');
    expect(result.pending.proposal.confidence).toBe(81);

    // Запись видна в общей очереди модуля 3.
    const queue = ws.pendingOperations();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.id).toBe(result.pending.id);
    expect(queue[0]!.proposal.explanation).toContain('уверенность OCR');
  });

  it('эвристика движка с большей уверенностью перебивает подсказку OCR (приоритет движка)', async () => {
    const ws = new AccountingWorkspace('demo-too');
    const result = unwrap(
      await intakeDocumentFile(ws, ocr, { fileName: 'скан-акт-12.jpg', today: D('2026-07-16') }),
    );
    // OCR дал 67%, эвристика «услуги» — 70%: предложение берёт движок,
    // но запись всё равно в очереди (документы не автопроводятся).
    expect(result.recognized.confidence).toBe(67);
    expect(result.pending.proposal.confidence).toBeGreaterThanOrEqual(67);
    expect(result.pending.status).toBe('PENDING');
  });

  it('высокая уверенность OCR НЕ проводит документ автоматически — только очередь', async () => {
    const ws = new AccountingWorkspace('demo-too');
    const result = unwrap(
      await intakeDocumentFile(ws, ocr, { fileName: 'чек-канцтовары.pdf', today: D('2026-07-16') }),
    );
    expect(result.recognized.confidence).toBe(93); // выше порога автопроводки
    expect(result.pending.status).toBe('PENDING');
    expect(ws.ledger.entries()).toHaveLength(0);
  });

  it('подтверждение документа создаёт проводку и обучающее правило (тот же use-case)', async () => {
    const ws = new AccountingWorkspace('demo-too');
    const result = unwrap(
      await intakeDocumentFile(ws, ocr, { fileName: 'такси-отчёт.jpg', today: D('2026-07-16') }),
    );
    const confirmed = unwrap(ws.confirm(result.pending.id, { confirmedBy: 'Айгерим', at: D('2026-07-16') }));
    expect(confirmed.entry.lines.map((l) => l.account).sort()).toEqual(['1250', '7210']);
    expect(confirmed.rule).not.toBeNull(); // подтверждение обучает движок
    expect(ws.pendingOperations()).toHaveLength(0);
  });

  it('нераспознанный файл — честная ошибка, не молчаливый пропуск', async () => {
    const ws = new AccountingWorkspace('demo-too');
    const result = await intakeDocumentFile(ws, ocr, { fileName: 'фото-кота.jpg', today: D('2026-07-16') });
    expect(result.ok).toBe(false);
  });
});
