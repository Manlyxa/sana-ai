import type { Bin, Money, Result, TaxNotice, TaxObligation, TaxPeriod } from '@sana/domain';
import type { PortError } from './common';
import type { SignatureArtifact } from './signature-port';

/** Сальдо лицевого счёта по виду платежа. */
export type LedgerBalance = {
  readonly taxType: string; // КБК или наименование
  readonly balance: Money; // положительное — переплата, отрицательное — недоимка
};

/** Категория риска по СУР. */
export type SurRiskCategory = 'НИЗКАЯ' | 'СРЕДНЯЯ' | 'ВЫСОКАЯ';

/** Подготовленная ФНО, ожидающая подписи. */
export type PreparedFno = {
  readonly formCode: '100.00' | '200.00' | '300.00' | '910.00';
  readonly period: TaxPeriod;
  readonly payloadXml: string;
};

export type FnoReceipt = {
  readonly submissionId: string;
  readonly acceptedAtIso: string;
};

/** Кабинет налогоплательщика (КГД). */
export interface TaxCabinetPort {
  listObligations(bin: Bin): Promise<Result<readonly TaxObligation[], PortError>>;
  ledgerBalances(bin: Bin): Promise<Result<readonly LedgerBalance[], PortError>>;
  listNotices(bin: Bin): Promise<Result<readonly TaxNotice[], PortError>>;
  surRiskCategory(bin: Bin): Promise<Result<SurRiskCategory, PortError>>;

  /**
   * Сдать ФНО. Действие A1: сигнатура типа делает невозможным вызов без
   * артефакта подписи владельца (P6). Порт никогда не принимает ключ.
   */
  submitFno(fno: PreparedFno, signature: SignatureArtifact): Promise<Result<FnoReceipt, PortError>>;
}
