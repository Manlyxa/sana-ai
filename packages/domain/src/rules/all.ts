import type { Rule } from './types';
import { vatCreditNoticeMissing } from './rules/vat-credit-notice-missing';
import { esfIssueOverdue } from './rules/esf-issue-overdue';
import { esfNonresidentOverdue } from './rules/esf-nonresident-overdue';
import { esfConfirmationPending } from './rules/esf-confirmation-pending';
import { vatThresholdApproaching, vatThresholdBreached } from './rules/vat-threshold';
import { counterpartyHighRisk } from './rules/counterparty-high-risk';
import { snrSupplierDeduction } from './rules/snr-supplier-deduction';
import { filingDeadlineApproaching, filingOverdue, paymentOverdue } from './rules/filing-deadlines';
import { ipnDeductionNoApplication, opvrAgeExemptionViolated } from './rules/payroll-consistency';
import { unclearedAdvance } from './rules/uncleared-advance';
import { taxNoticeUnanswered } from './rules/tax-notice-unanswered';
import { employmentContractNotRegistered, finalSettlementOverdue } from './rules/hr-compliance';
import { virtualWarehouseMismatch } from './rules/virtual-warehouse-mismatch';

/** Полный реестр правил MVP (§7). */
export const ALL_RULES: readonly Rule[] = [
  vatCreditNoticeMissing,
  esfIssueOverdue,
  esfNonresidentOverdue,
  esfConfirmationPending,
  vatThresholdApproaching,
  vatThresholdBreached,
  counterpartyHighRisk,
  snrSupplierDeduction,
  filingDeadlineApproaching,
  filingOverdue,
  paymentOverdue,
  ipnDeductionNoApplication,
  opvrAgeExemptionViolated,
  unclearedAdvance,
  taxNoticeUnanswered,
  employmentContractNotRegistered,
  finalSettlementOverdue,
  virtualWarehouseMismatch,
];
