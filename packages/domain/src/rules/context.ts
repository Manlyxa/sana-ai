import type { Bin, Iin } from '../kernel/bin-iin';
import type { LocalDate } from '../kernel/local-date';
import type { Money } from '../kernel/money';
import type { Rate } from '../kernel/rate';
import type { TaxPeriod } from '../kernel/tax-period';
import type { Company } from '../entities/company';
import type { Counterparty } from '../entities/counterparty';
import type { Employee } from '../entities/employee';
import type { Invoice } from '../entities/invoice';
import type { TaxObligation } from '../entities/tax-obligation';
import type { BusinessEvent } from '../ledger/business-event';

/**
 * CompanyContext — состояние компании на момент оценки правил.
 * Собирается слоем приложения из теневого регистра и сущностей;
 * правила — чистые функции над ним.
 */

/** Уведомление КГД (срок исполнения — 30 рабочих дней, далее блокировка счетов). */
export type TaxNotice = {
  readonly id: string;
  readonly receivedAt: LocalDate;
  readonly description: string;
  readonly respondedAt: LocalDate | null;
};

/** Подотчётная сумма (незакрытый аванс > 3 лет становится доходом физлица). */
export type OutstandingAdvance = {
  readonly id: string;
  readonly employeeIin: Iin;
  readonly issuedAt: LocalDate;
  readonly amount: Money;
  readonly clearedAt: LocalDate | null;
};

/** Уплата НДС за нерезидента: ЭСФ должен быть выписан в течение 5 дней. */
export type NonResidentVatPayment = {
  readonly id: string;
  readonly paidAt: LocalDate;
  readonly vatAmount: Money;
  readonly esfIssuedAt: LocalDate | null;
};

/** Строка расчётной ведомости из внешней системы (1С) — для сверки. */
export type ExternalPayrollRecord = {
  readonly employeeIin: Iin;
  readonly period: TaxPeriod;
  readonly gross: Money;
  readonly standardDeductionApplied: boolean;
  /** Начисленный ОПВР; ноль — не начислялся. */
  readonly opvrCharged: Money;
};

/** Окончательный расчёт при увольнении (3 рабочих дня, ТК РК). */
export type FinalSettlement = {
  readonly employeeIin: Iin;
  readonly terminatedAt: LocalDate;
  readonly amountDue: Money;
  readonly paidAt: LocalDate | null;
};

/** Остаток в ИС «Виртуальный склад» против нашего регистра. */
export type VirtualWarehouseBalance = {
  readonly productCode: string;
  readonly name: string;
  readonly vsQuantity: number;
  readonly ledgerQuantity: number;
  readonly unitValue: Money;
};

/**
 * Снимок правовых параметров на дату оценки. Домен не импортирует
 * @sana/legal-params — снимок собирает buildRuleLawParams там (P2, P5).
 */
export type RuleLawParams = {
  readonly version: string;
  readonly mrp: Money;
  readonly mzp: Money;
  readonly vatRegistrationThresholdMrp: number;
  readonly vatRegistrationApplicationWorkingDays: number;
  readonly esfIssueDeadlineCalendarDays: number;
  readonly esfNonresidentDeadlineCalendarDays: number;
  readonly fno300Closes: { readonly monthsAfterPeriodEnd: number; readonly dayOfMonth: number };
  readonly ipnBracket1Rate: Rate;
  readonly kpnRate: Rate;
  readonly opvrExemptIfBornBefore: LocalDate;
  readonly ipnStandardDeductionMrpPerMonth: number;
  readonly esutdRegistrationWorkingDays: number;
  readonly noticeResponseWorkingDays: number;
  /** Штрафы КоАП в МРП (TODO_VERIFY в legal-params). */
  readonly fineEsfNonIssueMrp: number;
  readonly fineFnoLateMrp: number;
  readonly fineEsutdMrp: number;
  readonly fineVatRegistrationMrp: number;
  /** Праздничные дни (ISO-даты) для расчёта рабочих дней. */
  readonly holidays: ReadonlySet<string>;
};

export type CompanyContext = {
  readonly company: Company;
  readonly counterparties: readonly Counterparty[];
  readonly invoices: readonly Invoice[];
  readonly obligations: readonly TaxObligation[];
  readonly employees: readonly Employee[];
  readonly events: readonly BusinessEvent[];
  readonly taxNotices: readonly TaxNotice[];
  readonly advances: readonly OutstandingAdvance[];
  readonly nonResidentVatPayments: readonly NonResidentVatPayment[];
  readonly externalPayroll: readonly ExternalPayrollRecord[];
  readonly finalSettlements: readonly FinalSettlement[];
  readonly virtualWarehouse: readonly VirtualWarehouseBalance[];
  readonly law: RuleLawParams;
};

export function findCounterparty(ctx: CompanyContext, bin: Bin): Counterparty | undefined {
  return ctx.counterparties.find((c) => c.bin.equals(bin));
}

export function findEmployee(ctx: CompanyContext, iin: Iin): Employee | undefined {
  return ctx.employees.find((e) => e.iin.equals(iin));
}
