import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { err, LocalDate, Money, ok, type Result } from '@sana/domain';
import type { DocumentOcrPort, PortError, RecognizedDocument } from '@sana/ports';
import { defaultFixturesRoot } from './fixture-root';

const fileSchema = z.object({
  recognitions: z.array(
    z.object({
      match: z.string(),
      title: z.string(),
      documentType: z.string(),
      date: z.string(),
      amountTenge: z.number().int().positive(),
      counterpartyName: z.string().nullable(),
      purpose: z.string(),
      confidence: z.number().int().min(0).max(100),
      debitAccount: z.string(),
      creditAccount: z.string(),
      category: z.string().nullable(),
    }),
  ),
});

/** Fixture-OCR (§8): распознавание по ключевому слову в имени файла. */
export class FixtureOcrAdapter implements DocumentOcrPort {
  constructor(private readonly fixturesRoot: string = defaultFixturesRoot()) {}

  async recognize(fileName: string): Promise<Result<RecognizedDocument, PortError>> {
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(
        JSON.parse(
          fs.readFileSync(path.join(this.fixturesRoot, 'documents', 'recognitions.json'), 'utf8'),
        ),
      );
    } catch (e) {
      return err({ kind: 'PARSE', message: `documents/recognitions.json: ${String(e)}` });
    }
    const low = fileName.toLowerCase();
    const hit = parsed.recognitions.find((r) => low.includes(r.match));
    if (hit === undefined) {
      return err({ kind: 'NOT_FOUND', message: `документ «${fileName}» не распознан demo-OCR` });
    }
    const date = LocalDate.parse(hit.date);
    if (!date.ok) return err({ kind: 'PARSE', message: `дата документа: ${date.error}` });
    return ok({
      title: hit.title,
      documentType: hit.documentType,
      date: date.value,
      amount: Money.ofMajor(hit.amountTenge),
      counterpartyName: hit.counterpartyName,
      purpose: hit.purpose,
      confidence: hit.confidence,
      debitAccount: hit.debitAccount,
      creditAccount: hit.creditAccount,
      category: hit.category,
    });
  }
}
