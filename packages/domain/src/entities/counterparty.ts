import type { Bin } from '../kernel/bin-iin';
import type { LocalDate } from '../kernel/local-date';
import { err, ok, type Result } from '../kernel/result';
import { invalid, type ValidationError } from './validation';
import type { TaxRegime } from './company';

/** Флаги риска контрагента (§4 спецификации). */
export const RISK_FLAGS = [
  'LZHEPREDPRIYATIE', // признан лжепредприятием
  'E_TAMGA', // отметка e-Tamga
  'TAX_DEBT', // налоговая задолженность
  'BANKRUPTCY', // банкротство
  'OKED_MISMATCH', // операции не соответствуют ОКЭД
  'INACTIVE', // бездействующий
] as const;

export type RiskFlag = (typeof RISK_FLAGS)[number];

/** Флаги, при которых сделка сама по себе — критический риск (доначисления). */
export const CRITICAL_RISK_FLAGS: readonly RiskFlag[] = [
  'LZHEPREDPRIYATIE',
  'E_TAMGA',
  'BANKRUPTCY',
];

export type Counterparty = {
  readonly bin: Bin;
  readonly name: string;
  readonly vatPayer: boolean;
  /** Режим контрагента, если известен (важно для вычетов по КПН). */
  readonly taxRegime: TaxRegime | 'НЕИЗВЕСТНО';
  /** 0 (чисто) … 100 (максимальный риск). */
  readonly riskScore: number;
  readonly riskFlags: readonly RiskFlag[];
  readonly lastCheckedAt: LocalDate | null;
};

export function createCounterparty(input: Counterparty): Result<Counterparty, ValidationError[]> {
  const errors: ValidationError[] = [];
  if (input.name.trim() === '') errors.push(invalid('name', 'наименование обязательно'));
  if (!Number.isInteger(input.riskScore) || input.riskScore < 0 || input.riskScore > 100) {
    errors.push(invalid('riskScore', 'riskScore — целое в диапазоне 0–100'));
  }
  if (new Set(input.riskFlags).size !== input.riskFlags.length) {
    errors.push(invalid('riskFlags', 'флаги риска не должны повторяться'));
  }
  if (errors.length > 0) return err(errors);
  return ok({ ...input, riskFlags: [...input.riskFlags] });
}

/** Есть ли у контрагента критический флаг риска. */
export function hasCriticalRiskFlag(cp: Counterparty): boolean {
  return cp.riskFlags.some((f) => CRITICAL_RISK_FLAGS.includes(f));
}
