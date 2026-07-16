import { err, LocalDate, Money, ok, type Result } from '@sana/domain';

/** Утилиты разбора данных на границе системы. */

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** «3500000.00» → Money (тиын). Без плавающей точки. */
export function parseDecimalTenge(text: string): Result<Money, string> {
  const m = DECIMAL_RE.exec(text.trim());
  if (!m) return err(`не денежная сумма: "${text}"`);
  const sign = m[1] === '-' ? -1n : 1n;
  const major = BigInt(m[2] as string);
  const minorText = (m[3] ?? '').padEnd(2, '0');
  const minor = BigInt(minorText === '' ? '0' : minorText);
  return ok(Money.ofMinor(sign * (major * 100n + minor)));
}

export function parseIsoDate(text: string): Result<LocalDate, string> {
  return LocalDate.parse(text.trim());
}

/**
 * Микро-извлечение из контролируемого fixture-XML. НЕ универсальный
 * XML-парсер: реальный адаптер ИС ЭСФ будет использовать полноценный
 * разбор. Для канонических фикстур этого достаточно.
 */
export function xmlTag(content: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(content);
  return m === null ? null : (m[1] as string).trim();
}

export function xmlTags(content: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = [];
  for (const m of content.matchAll(re)) out.push((m[1] as string).trim());
  return out;
}
