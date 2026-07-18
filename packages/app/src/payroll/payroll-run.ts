import {
  computePayrollSequence,
  emptyYtd,
  err,
  Money,
  ok,
  CHART_OF_ACCOUNTS_VERSION,
  type LedgerEntryInput,
  type LocalDate,
  type PayrollLawParams,
  type PayrollMonthResult,
  type Result,
  type TaxPeriod,
  type YtdRecord,
} from '@sana/domain';
import type { PayrollEmployeeRecord } from './load-payroll';

/**
 * Зарплатная ведомость месяца (§6, экран «Зарплата и кадры»).
 *
 * Деньги считает доменный движок (computePayrollSequence): ИПН —
 * нарастающим итогом с января, поэтому вход каждого сотрудника — вся
 * последовательность месяцев с начала года, а не один месяц. Слой app
 * добавляет то, что видно в мокапе: расшифровку по сотруднику, статус
 * «Ждёт проверки → Проверено» и начисление в реестр одной сбалансированной
 * проводкой после подтверждения всех строк.
 */

export type PayrollLineStatus = 'PENDING' | 'CONFIRMED';

export type PayrollLine = {
  readonly iin: string;
  readonly fullName: string;
  readonly position: string;
  /** Расчёт целевого месяца — целиком из доменного движка. */
  readonly result: PayrollMonthResult;
  /** Накопительный итог ДО целевого месяца (для расшифровки в UI). */
  readonly prevYtd: YtdRecord;
  readonly status: PayrollLineStatus;
  readonly confirmation: { readonly by: string; readonly at: LocalDate } | null;
};

export type PayrollRunError = { readonly message: string };

export type PayrollSummary = {
  readonly employees: number;
  readonly confirmed: number;
  readonly totalGross: Money;
  /** Удержано с работников: ИПН + ОПВ + ВОСМС. */
  readonly totalWithheld: Money;
  /** За счёт компании: СО + ООСМС + ОПВР + СН. */
  readonly totalEmployerCost: Money;
  readonly totalNet: Money;
  readonly paramsVersion: string;
};

export class PayrollRun {
  private constructor(
    readonly companyId: string,
    readonly month: TaxPeriod,
    private readonly linesByIin: Map<string, PayrollLine>,
  ) {}

  /**
   * Считает ведомость за месяц: для каждого сотрудника прогоняется
   * последовательность январь..месяц (нарастающий итог), берётся
   * результат целевого месяца. Сотрудники с нулевым доходом месяца
   * в ведомость не попадают.
   */
  static create(args: {
    readonly companyId: string;
    readonly month: TaxPeriod;
    readonly records: readonly PayrollEmployeeRecord[];
    readonly params: PayrollLawParams;
  }): Result<PayrollRun, PayrollRunError> {
    if (args.month.kind !== 'MONTH') {
      return err({ message: `ведомость строится за месяц, получен период ${args.month.code()}` });
    }
    const lines = new Map<string, PayrollLine>();
    for (const record of args.records) {
      const months = [];
      for (let m = 1; m <= args.month.index; m++) {
        months.push({ gross: record.grossByMonth.get(m) ?? Money.zero(), params: args.params });
      }
      const computed = computePayrollSequence(record.employee, months);
      if (!computed.ok) {
        return err({ message: `${record.employee.fullName}: ${computed.error.message}` });
      }
      const sequence = computed.value;
      const result = sequence[sequence.length - 1];
      if (result === undefined || result.gross.isZero()) continue;
      const prevYtd = sequence.length > 1 ? sequence[sequence.length - 2]!.ytd : emptyYtd();
      lines.set(record.employee.iin.value, {
        iin: record.employee.iin.value,
        fullName: record.employee.fullName,
        position: record.position,
        result,
        prevYtd,
        status: 'PENDING',
        confirmation: null,
      });
    }
    return ok(new PayrollRun(args.companyId, args.month, lines));
  }

  lines(): readonly PayrollLine[] {
    return [...this.linesByIin.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  }

  line(iin: string): PayrollLine | null {
    return this.linesByIin.get(iin) ?? null;
  }

  /** «Подтвердить расчёт» — смена статуса строки, повторное подтверждение — ошибка. */
  confirm(
    iin: string,
    args: { readonly confirmedBy: string; readonly at: LocalDate },
  ): Result<PayrollLine, PayrollRunError> {
    const line = this.linesByIin.get(iin);
    if (line === undefined) return err({ message: `сотрудник с ИИН ${iin} не найден в ведомости` });
    if (line.status === 'CONFIRMED') {
      return err({ message: `расчёт по ${line.fullName} уже подтверждён` });
    }
    const confirmed: PayrollLine = {
      ...line,
      status: 'CONFIRMED',
      confirmation: { by: args.confirmedBy, at: args.at },
    };
    this.linesByIin.set(iin, confirmed);
    return ok(confirmed);
  }

  /** Подтвердить оставшиеся строки разом («Подтвердить все и начислить»). */
  confirmAll(args: { readonly confirmedBy: string; readonly at: LocalDate }): number {
    let confirmed = 0;
    for (const line of this.linesByIin.values()) {
      if (line.status === 'PENDING') {
        this.confirm(line.iin, args);
        confirmed += 1;
      }
    }
    return confirmed;
  }

  summary(): PayrollSummary {
    let totalGross = Money.zero();
    let totalWithheld = Money.zero();
    let totalEmployerCost = Money.zero();
    let totalNet = Money.zero();
    let confirmed = 0;
    let paramsVersion = '';
    for (const line of this.linesByIin.values()) {
      const r = line.result;
      totalGross = totalGross.add(r.gross);
      totalWithheld = totalWithheld.add(r.ipn).add(r.opv).add(r.vosms);
      totalEmployerCost = totalEmployerCost
        .add(r.employer.so)
        .add(r.employer.oosms)
        .add(r.employer.opvr)
        .add(r.employer.sn);
      totalNet = totalNet.add(r.net);
      paramsVersion = r.paramsVersion;
      if (line.status === 'CONFIRMED') confirmed += 1;
    }
    return {
      employees: this.linesByIin.size,
      confirmed,
      totalGross,
      totalWithheld,
      totalEmployerCost,
      totalNet,
      paramsVersion,
    };
  }

  /**
   * Начисление за месяц одной проводкой (после подтверждения всех строк):
   *   Дт 7210  ФОТ + взносы компании
   *   Кт 3350  к выплате
   *   Кт 3120  ИПН
   *   Кт 3220  ОПВ + ОПВР
   *   Кт 3150  СН
   *   Кт 3190  ВОСМС + ООСМС + СО
   * Проводка сбалансирована по построению; реестр отвергнет её иначе.
   */
  accrualEntryInput(args: { readonly date: LocalDate }): Result<LedgerEntryInput, PayrollRunError> {
    if (this.linesByIin.size === 0) return err({ message: 'ведомость пуста — начислять нечего' });
    const pending = [...this.linesByIin.values()].filter((l) => l.status === 'PENDING');
    if (pending.length > 0) {
      return err({
        message: `не подтверждены расчёты: ${pending.map((l) => l.fullName).join(', ')}`,
      });
    }
    const s = this.summary();
    let ipn = Money.zero();
    let opvTotal = Money.zero();
    let sn = Money.zero();
    let other = Money.zero();
    for (const line of this.linesByIin.values()) {
      const r = line.result;
      ipn = ipn.add(r.ipn);
      opvTotal = opvTotal.add(r.opv).add(r.employer.opvr);
      sn = sn.add(r.employer.sn);
      other = other.add(r.vosms).add(r.employer.oosms).add(r.employer.so);
    }
    const lines = [
      { account: '7210', side: 'DEBIT' as const, amount: s.totalGross.add(s.totalEmployerCost) },
      { account: '3350', side: 'CREDIT' as const, amount: s.totalNet },
      { account: '3120', side: 'CREDIT' as const, amount: ipn },
      { account: '3220', side: 'CREDIT' as const, amount: opvTotal },
      { account: '3150', side: 'CREDIT' as const, amount: sn },
      { account: '3190', side: 'CREDIT' as const, amount: other },
    ].filter((l) => l.amount.isPositive());
    return ok({
      id: `payroll-${this.companyId}-${this.month.code()}`,
      companyId: this.companyId,
      sourceEventId: `payroll-run-${this.month.code()}`,
      date: args.date,
      lines,
      memo: `Начисление заработной платы за ${this.month.code()} (${s.employees} сотр.)`,
      analytics: { counterpartyBin: null, counterpartyName: null, category: 'Оплата труда' },
      norm: 'ст. 320–321 НК РК; ст. 243–251 Социального кодекса РК',
      legalParamsVersion: `${s.paramsVersion}; ${CHART_OF_ACCOUNTS_VERSION}`,
      reversesEntryId: null,
    });
  }
}
