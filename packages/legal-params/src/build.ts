import {
  type LocalDate,
  type PayrollLawParams,
  type Result,
  type RuleLawParams,
  ok,
} from '@sana/domain';
import { P } from './keys';
import type { LegalParameterStore } from './store';
import type { ParamKey, ResolveError } from './types';

/**
 * Сборка снимков правовых параметров для доменных движков (P2, P5).
 * Домен не знает о хранилище — он получает готовый снимок на дату расчёта.
 */

function resolver(store: LegalParameterStore, asOf: LocalDate) {
  return function resolve<T>(key: ParamKey<T>): T {
    const r = store.resolve(key, asOf);
    if (!r.ok) throw new ResolveFailure(r.error);
    return r.value.value;
  };
}

class ResolveFailure extends Error {
  constructor(readonly resolveError: ResolveError) {
    super(`legal parameter resolve failed: ${JSON.stringify(resolveError)}`);
  }
}

function catching<T>(fn: () => T): Result<T, ResolveError> {
  try {
    return ok(fn());
  } catch (e) {
    if (e instanceof ResolveFailure) return { ok: false, error: e.resolveError };
    throw e;
  }
}

export function buildPayrollLawParams(
  store: LegalParameterStore,
  asOf: LocalDate,
): Result<PayrollLawParams, ResolveError> {
  const get = resolver(store, asOf);
  return catching(() => {
    const opv = get(P.OPV);
    const vosms = get(P.VOSMS);
    const opvr = get(P.OPVR);
    const so = get(P.SO);
    const oosms = get(P.OOSMS);
    const sn = get(P.SN);
    const deduction = get(P.IPN_STANDARD_DEDUCTION);
    const additional = get(P.IPN_ADDITIONAL_DEDUCTION_MRP);
    return {
      version: `legal-params@${asOf.toISO()}`,
      mrp: get(P.MRP),
      mzp: get(P.MZP),
      opv: { rate: opv.rate, capMzp: opv.capMzp },
      vosms: { rate: vosms.rate, capMzp: vosms.capMzp },
      opvr: {
        rate: opvr.rate,
        capMzp: opvr.capMzp,
        exemptIfBornBefore: opvr.exemptIfBornBefore,
      },
      so: { rate: so.rate, floorMzp: so.floorMzp, capMzp: so.capMzp },
      oosms: { rate: oosms.rate, capMzp: oosms.capMzp },
      sn: { rate: sn.rate },
      ipn: {
        bracket1Rate: get(P.IPN_BRACKET1_RATE),
        bracket1CeilingMrp: get(P.IPN_BRACKET1_CEILING_MRP),
        bracket2Rate: get(P.IPN_BRACKET2_RATE),
        standardDeductionMrpPerMonth: deduction.mrpPerMonth,
        standardDeductionMrpAnnualMax: deduction.mrpAnnualMax,
        additionalDeductionDisabilityMrpAnnual: additional.disabilityAnnual,
      },
    };
  });
}

export function buildRuleLawParams(
  store: LegalParameterStore,
  asOf: LocalDate,
): Result<RuleLawParams, ResolveError> {
  const get = resolver(store, asOf);
  return catching(() => {
    const window = get(P.FNO_300_FILING_WINDOW);
    const opvr = get(P.OPVR);
    const deduction = get(P.IPN_STANDARD_DEDUCTION);
    return {
      version: `legal-params@${asOf.toISO()}`,
      mrp: get(P.MRP),
      mzp: get(P.MZP),
      vatRegistrationThresholdMrp: get(P.VAT_REGISTRATION_THRESHOLD_MRP),
      vatRegistrationApplicationWorkingDays: get(P.VAT_REGISTRATION_APPLICATION_DAYS).days,
      esfIssueDeadlineCalendarDays: get(P.ESF_ISSUE_DEADLINE).days,
      esfNonresidentDeadlineCalendarDays: get(P.ESF_NONRESIDENT_DEADLINE).days,
      fno300Closes: window.closes,
      ipnBracket1Rate: get(P.IPN_BRACKET1_RATE),
      kpnRate: get(P.KPN_RATE_STANDARD),
      opvrExemptIfBornBefore: opvr.exemptIfBornBefore,
      ipnStandardDeductionMrpPerMonth: deduction.mrpPerMonth,
      esutdRegistrationWorkingDays: get(P.ESUTD_REGISTRATION_DEADLINE).days,
      noticeResponseWorkingDays: get(P.KGD_NOTICE_RESPONSE_DAYS).days,
      fineEsfNonIssueMrp: get(P.KOAP_ESF_NONISSUE_FINE_MRP),
      fineFnoLateMrp: get(P.KOAP_FNO_LATE_FINE_MRP),
      fineEsutdMrp: get(P.KOAP_ESUTD_FINE_MRP),
      fineVatRegistrationMrp: get(P.KOAP_VAT_REGISTRATION_FINE_MRP),
      holidays: new Set(get(P.CALENDAR_HOLIDAYS)),
    };
  });
}
