import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  calculateVatThreshold,
  computeForm910,
  Money,
  revenueForPeriod,
  TaxPeriod,
} from '@sana/domain';
import { loadPayrollRecords, PayrollRun } from '@sana/app';
import {
  buildForm910Params,
  buildPayrollLawParams,
  buildRuleLawParams,
  createSeededStore,
  P,
} from '@sana/legal-params';
import { periodOffsetDate } from '@sana/domain';
import { accountingWorkspace } from './accounting-router';
import type { ApiContext } from './context';

/**
 * Декларации ФНО (§5): 910.00 заполняется расчётом из реестра;
 * 200.00 — свод из зарплатных ведомостей квартала; 300.00 — мониторинг
 * порога НДС (компания не плательщик). Никакого текста вместо цифр.
 */

const t = initTRPC.context<ApiContext>().create();

function money(m: Money): { tiyn: string; tenge: string } {
  return { tiyn: m.amount.toString(), tenge: m.toDecimalString() };
}

function parseHalfYear(code: string): TaxPeriod {
  const parsed = TaxPeriod.parse(code);
  if (!parsed.ok || parsed.value.kind !== 'HALF_YEAR') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `нужно полугодие (например 2026-H1), получено: ${code}` });
  }
  return parsed.value;
}

async function form200Summary(ctx: ApiContext, quarter: TaxPeriod) {
  const records = await loadPayrollRecords(
    { enbek: ctx.ports.enbek, payroll: ctx.payrollData },
    ctx.company.bin,
    quarter.year,
  );
  if (!records.ok) throw new TRPCError({ code: 'BAD_GATEWAY', message: records.error.message });
  let ipn = Money.zero();
  let opv = Money.zero();
  let employees = 0;
  for (const month of quarter.months()) {
    const params = buildPayrollLawParams(createSeededStore(), month.end());
    if (!params.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры не собраны' });
    const run = PayrollRun.create({
      companyId: ctx.company.id,
      month,
      records: records.value,
      params: params.value,
    });
    if (!run.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: run.error.message });
    const s = run.value.summary();
    employees = Math.max(employees, s.employees);
    for (const line of run.value.lines()) {
      ipn = ipn.add(line.result.ipn);
      opv = opv.add(line.result.opv);
    }
  }
  return { ipn, opv, employees };
}

export const declarationsRouter = t.router({
  /** Список деклараций со статусами и цифрами из реального расчёта. */
  list: t.procedure.query(async ({ ctx }) => {
    const store = createSeededStore();
    const entries = accountingWorkspace(ctx).ledger.entries();

    // 910.00 — расчёт за текущее полугодие.
    const half = TaxPeriod.containing('HALF_YEAR', ctx.today);
    const p910 = buildForm910Params(store, ctx.today);
    if (!p910.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры 910.00 не собраны' });
    const form910 = computeForm910(entries, half, p910.value);
    if (!form910.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: form910.error.message });
    const periodEnded = half.end().isBefore(ctx.today);

    // 200.00 — свод квартала из ведомостей.
    const quarter = TaxPeriod.containing('QUARTER', ctx.today);
    const f200 = await form200Summary(ctx, quarter);
    const due200Param = store.resolve(P.FNO_200_FILING_DUE, ctx.today);
    if (!due200Param.ok) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'срок 200.00 не определён' });
    }
    const due200 = periodOffsetDate(quarter.end(), due200Param.value.value);

    // 300.00 — мониторинг порога НДС по обороту реестра с начала года.
    const law = buildRuleLawParams(store, ctx.today);
    if (!law.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры не собраны' });
    const yearRevenue = revenueForPeriod(entries, TaxPeriod.year(ctx.today.year));
    const vat = calculateVatThreshold(yearRevenue.income, {
      mrp: law.value.mrp,
      thresholdMrp: law.value.vatRegistrationThresholdMrp,
    });
    if (!vat.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: vat.error.message });

    return [
      {
        форма: '910.00',
        описание: `Упрощённая декларация · за ${form910.value.period.code()}`,
        статус: periodEnded ? ('Готово к сдаче' as const) : ('В процессе' as const),
        срок: form910.value.filingDeadline.toISO(),
        поля: {
          доход: money(form910.value.income),
          ставка: form910.value.rate.toPercentString(),
          налогКУплате: money(form910.value.tax),
          период: `${form910.value.period.start().toISO()} – ${form910.value.period.end().toISO()}`,
        },
        норма: form910.value.norm,
        версияПараметров: form910.value.paramsVersion,
      },
      {
        форма: '200.00',
        описание: `ИПН и соцплатежи · за ${quarter.code()}`,
        статус: quarter.end().isBefore(ctx.today) ? ('Готово к сдаче' as const) : ('В процессе' as const),
        срок: due200.toISO(),
        поля: {
          начисленоИпн: money(f200.ipn),
          опв: money(f200.opv),
          сотрудников: f200.employees,
        },
        норма: 'ст. 489 НК РК',
        версияПараметров: `legal-params@${ctx.today.toISO()}`,
      },
      {
        форма: '300.00',
        описание: 'НДС · компания пока не плательщик',
        статус: vat.value.breached ? ('Требуется регистрация' as const) : ('Мониторинг' as const),
        срок: null,
        поля: {
          оборотСНачалаГода: money(vat.value.turnover),
          порогРегистрации: money(vat.value.threshold),
          осталосьДоПорога: money(vat.value.remaining),
          занятоПроцентов: vat.value.usedPercent,
        },
        норма: 'ст. 99 НК РК',
        версияПараметров: law.value.version,
      },
    ];
  }),

  /** Полная форма 910.00 за указанное полугодие, с проводками-основаниями. */
  form910: t.procedure
    .input(z.object({ period: z.string().default('2026-H1') }).optional())
    .query(({ ctx, input }) => {
      const period = parseHalfYear(input?.period ?? '2026-H1');
      const params = buildForm910Params(createSeededStore(), ctx.today);
      if (!params.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'параметры не собраны' });
      const form = computeForm910(accountingWorkspace(ctx).ledger.entries(), period, params.value);
      if (!form.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: form.error.message });
      const f = form.value;
      return {
        период: f.period.code(),
        доход: money(f.income),
        ставка: f.rate.toPercentString(),
        налогКУплате: money(f.tax),
        срокСдачи: f.filingDeadline.toISO(),
        пределДоходаСнр: money(f.incomeLimit),
        пределПревышен: f.limitExceeded,
        проводкиОснования: f.revenueEntryIds,
        норма: f.norm,
        версияПараметров: f.paramsVersion,
      };
    }),
});
