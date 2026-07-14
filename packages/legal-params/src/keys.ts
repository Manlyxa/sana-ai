import type { Money, Rate } from '@sana/domain';
import { paramKey } from './types';
import type {
  CappedRateMzp,
  DayCount,
  FilingWindow,
  IpnStandardDeduction,
  OpvrParams,
  PeriodOffsetDate,
  SnParams,
  SoParams,
} from './types';

/**
 * Реестр типизированных ключей. Единственное место, где строковый id
 * связывается с типом значения. Доменный код обращается к параметрам
 * только через эти ключи — опечатка в ключе становится ошибкой компиляции.
 */
export const P = {
  // Базовые показатели
  MRP: paramKey<Money>('mrp'),
  MZP: paramKey<Money>('mzp'),

  // НДС
  VAT_RATE_STANDARD: paramKey<Rate>('vat.rate.standard'),
  VAT_RATE_REDUCED_MEDICAL: paramKey<Rate>('vat.rate.reduced.medical'),
  VAT_RATE_EXPORT: paramKey<Rate>('vat.rate.export'),
  VAT_REGISTRATION_THRESHOLD_MRP: paramKey<number>('vat.registration.threshold.mrp'),
  VAT_REGISTRATION_APPLICATION_DAYS: paramKey<DayCount>('vat.registration.application.days'),

  // КПН
  KPN_RATE_STANDARD: paramKey<Rate>('kpn.rate.standard'),

  // ИПН
  IPN_BRACKET1_RATE: paramKey<Rate>('ipn.bracket1.rate'),
  IPN_BRACKET1_CEILING_MRP: paramKey<number>('ipn.bracket1.ceiling.mrp'),
  IPN_BRACKET2_RATE: paramKey<Rate>('ipn.bracket2.rate'),
  IPN_STANDARD_DEDUCTION: paramKey<IpnStandardDeduction>('ipn.standard.deduction'),

  // Социальные платежи
  OPV: paramKey<CappedRateMzp>('opv'),
  OPVR: paramKey<OpvrParams>('opvr'),
  SO: paramKey<SoParams>('so'),
  OOSMS: paramKey<CappedRateMzp>('oosms'),
  VOSMS: paramKey<CappedRateMzp>('vosms'),
  SN: paramKey<SnParams>('sn'),

  // СНР
  SNR_UPROSHCHENKA_RATE: paramKey<Rate>('snr.uproshchenka.rate'),
  SNR_UPROSHCHENKA_INCOME_LIMIT_MRP: paramKey<number>('snr.uproshchenka.income.limit.mrp'),

  // ЭСФ
  ESF_ISSUE_DEADLINE: paramKey<DayCount>('esf.issue.deadline'),
  ESF_NONRESIDENT_DEADLINE: paramKey<DayCount>('esf.nonresident.deadline'),

  // Сроки ФНО и уплаты
  FNO_300_FILING_WINDOW: paramKey<FilingWindow>('fno.300.filing.window'),
  FNO_300_PAYMENT_DUE: paramKey<PeriodOffsetDate>('fno.300.payment.due'),
  FNO_200_FILING_DUE: paramKey<PeriodOffsetDate>('fno.200.filing.due'),
  FNO_100_FILING_DUE: paramKey<PeriodOffsetDate>('fno.100.filing.due'),
  FNO_910_FILING_DUE: paramKey<PeriodOffsetDate>('fno.910.filing.due'),
  PAYROLL_TAXES_PAYMENT_DUE: paramKey<PeriodOffsetDate>('payroll.taxes.payment.due'),

  // §10 — требуют подтверждения экспертом (TODO_VERIFY)
  IPN_DIVIDENDS: paramKey<{ rate: Rate; ceilingMrp: number }>('ipn.dividends'),
  UNIFIED_PAYMENT_RATE: paramKey<Rate>('unified.payment.rate'),
  ESUTD_REGISTRATION_DEADLINE: paramKey<DayCount>('esutd.registration.deadline'),
  CASH_SETTLEMENT_LIMIT_MRP: paramKey<number>('cash.settlement.limit.mrp'),
  KPN_LOSS_CARRYFORWARD_YEARS: paramKey<number>('kpn.loss.carryforward.years'),
  KPN_DEPRECIATION_NORMS: paramKey<Record<'I' | 'II' | 'III' | 'IV', Rate>>('kpn.depreciation.norms'),
  SNR_SUPPLIER_DEDUCTION_BAN: paramKey<{ scope: string }>('snr.supplier.deduction.ban'),
  AUDIT_MANDATORY_THRESHOLDS: paramKey<{ description: string }>('audit.mandatory.thresholds'),
} as const;
