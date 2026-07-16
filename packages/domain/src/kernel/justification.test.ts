import { describe, expect, it } from 'vitest';
import { createJustification } from './justification';
import { unwrap } from './result';

describe('Justification', () => {
  const valid = {
    norm: 'п. 8 ст. 480 НК РК',
    sourceDocuments: [
      { system: 'ИС ЭСФ', documentType: 'ЭСФ', documentId: 'ESF-2026-000123' },
    ],
    parameterVersion: 'vat.rate.standard@2026-01-01',
    explanation: 'Извещение о зачёте НДС не отправлено — зачёт будет потерян.',
  };

  it('создаёт валидное обоснование и копирует документы', () => {
    const j = unwrap(createJustification(valid));
    expect(j.norm).toBe(valid.norm);
    expect(j.sourceDocuments).toEqual(valid.sourceDocuments);
    expect(j.sourceDocuments).not.toBe(valid.sourceDocuments);
  });

  it('отвергает пустые norm/explanation/parameterVersion', () => {
    expect(createJustification({ ...valid, norm: '  ' }).ok).toBe(false);
    expect(createJustification({ ...valid, explanation: '' }).ok).toBe(false);
    expect(createJustification({ ...valid, parameterVersion: ' ' }).ok).toBe(false);
  });
});
