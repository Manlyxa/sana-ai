import type { Bin } from '../kernel/bin-iin';
import type { LocalDate } from '../kernel/local-date';
import { err, ok, type Result } from '../kernel/result';
import { invalid, type ValidationError } from './validation';

export type TaxRegime = 'ОУР' | 'СНР_УПРОЩЁНКА' | 'СНР_САМОЗАНЯТЫЙ' | 'СНР_КФХ';

export type ReportingStandard = 'НСФО' | 'МСФО_МСБ' | 'МСФО';

export type VatStatus =
  | { readonly registered: true; readonly since: LocalDate; readonly certificateNumber?: string }
  | { readonly registered: false };

/**
 * Минимум учётной политики, влияющий на автоматизацию.
 * Расширяется по мере появления правил, которые от неё зависят.
 */
export type AccountingPolicy = {
  /** Метод отнесения НДС в зачёт при смешанных оборотах. */
  readonly vatCreditMethod: 'ПРОПОРЦИОНАЛЬНЫЙ' | 'РАЗДЕЛЬНЫЙ';
};

export type Company = {
  /** Внутренний идентификатор Sana (для связи с событиями). */
  readonly id: string;
  readonly bin: Bin;
  readonly name: string;
  /** Коды ОКЭД (первый — основной). */
  readonly oked: readonly string[];
  readonly taxRegime: TaxRegime;
  readonly vatStatus: VatStatus;
  readonly reportingStandard: ReportingStandard;
  readonly accountingPolicy: AccountingPolicy;
  readonly employeeCount: number;
};

const OKED_RE = /^\d{5}$/;

export function createCompany(input: Company): Result<Company, ValidationError[]> {
  const errors: ValidationError[] = [];
  if (input.id.trim() === '') errors.push(invalid('id', 'внутренний id обязателен'));
  if (input.name.trim() === '') errors.push(invalid('name', 'наименование обязательно'));
  if (input.oked.length === 0) {
    errors.push(invalid('oked', 'нужен хотя бы один код ОКЭД'));
  } else {
    for (const code of input.oked) {
      if (!OKED_RE.test(code)) errors.push(invalid('oked', `код ОКЭД — 5 цифр: "${code}"`));
    }
  }
  if (!Number.isInteger(input.employeeCount) || input.employeeCount < 0) {
    errors.push(invalid('employeeCount', 'число работников — целое ≥ 0'));
  }
  if (errors.length > 0) return err(errors);
  return ok({ ...input, oked: [...input.oked] });
}
