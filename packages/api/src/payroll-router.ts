import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { TaxPeriod, type Money } from '@sana/domain';
import { loadPayrollRecords, PayrollRun, type PayrollLine } from '@sana/app';
import { buildPayrollLawParams, createSeededStore } from '@sana/legal-params';
import { accountingWorkspace, persistLedger } from './accounting-router';
import type { ApiContext } from './context';

/**
 * Зарплата и кадры (§6, экран «Зарплата и кадры» мокапа). Все суммы
 * считает доменный движок (нарастающий ИПН); здесь — ведомость,
 * подтверждение строк и начисление в реестр.
 */

const t = initTRPC.context<ApiContext>().create();

/** Ведомости по месяцам на контекст (single-company MVP). */
const runsByContext = new WeakMap<object, Map<string, PayrollRun>>();

const DEFAULT_MONTH = '2026-M07';

function parseMonth(code: string): TaxPeriod {
  const parsed = TaxPeriod.parse(code);
  if (!parsed.ok || parsed.value.kind !== 'MONTH') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `нужен месячный период (например 2026-M07), получено: ${code}` });
  }
  return parsed.value;
}

async function payrollRun(ctx: ApiContext, monthCode: string): Promise<PayrollRun> {
  let runs = runsByContext.get(ctx);
  if (runs === undefined) {
    runs = new Map();
    runsByContext.set(ctx, runs);
  }
  const existing = runs.get(monthCode);
  if (existing !== undefined) return existing;

  const month = parseMonth(monthCode);
  const records = await loadPayrollRecords(
    { enbek: ctx.ports.enbek, payroll: ctx.payrollData },
    ctx.company.bin,
    month.year,
  );
  if (!records.ok) {
    throw new TRPCError({ code: 'BAD_GATEWAY', message: records.error.message });
  }
  const params = buildPayrollLawParams(createSeededStore(), month.end());
  if (!params.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'правовые параметры не собраны' });
  }
  const run = PayrollRun.create({ companyId: ctx.company.id, month, records: records.value, params: params.value });
  if (!run.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: run.error.message });
  }
  runs.set(monthCode, run.value);
  return run.value;
}

function money(m: Money): { tiyn: string; tenge: string } {
  return { tiyn: m.amount.toString(), tenge: m.toDecimalString() };
}

function lineDto(l: PayrollLine) {
  return {
    иин: l.iin,
    фио: l.fullName,
    должность: l.position,
    статус: l.status === 'CONFIRMED' ? ('Проверено' as const) : ('Ждёт проверки' as const),
    начислено: money(l.result.gross),
    опв: money(l.result.opv),
    восмс: money(l.result.vosms),
    ипн: money(l.result.ipn),
    кВыплате: money(l.result.net),
    соЗаСчётКомпании: money(l.result.employer.so),
    доходСНачалаГодаДоМесяца: money(l.prevYtd.cumTaxableIncome),
    ипнСНачалаГодаДоМесяца: money(l.prevYtd.cumIpn),
    норма: 'ст. 320–321 НК РК (ИПН нарастающим итогом); ст. 243–251 Социального кодекса РК',
    версияПараметров: l.result.paramsVersion,
    подтверждение: l.confirmation === null ? null : { кто: l.confirmation.by, когда: l.confirmation.at.toISO() },
  };
}

const monthInput = z.object({ month: z.string().default(DEFAULT_MONTH) });

export const payrollRouter = t.router({
  /** Ведомость месяца: сводка + расшифровка по каждому сотруднику. */
  sheet: t.procedure.input(monthInput.optional()).query(async ({ ctx, input }) => {
    const run = await payrollRun(ctx, input?.month ?? DEFAULT_MONTH);
    const s = run.summary();
    return {
      месяц: run.month.code(),
      сводка: {
        сотрудников: s.employees,
        проверено: s.confirmed,
        начислено: money(s.totalGross),
        удержано: money(s.totalWithheld),
        заСчётКомпании: money(s.totalEmployerCost),
        кВыплате: money(s.totalNet),
        версияПараметров: s.paramsVersion,
      },
      строки: run.lines().map(lineDto),
    };
  }),

  /** «Подтвердить расчёт» по сотруднику — реальная смена статуса. */
  confirm: t.procedure
    .input(monthInput.extend({ iin: z.string().min(12).max(12), confirmedBy: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await payrollRun(ctx, input.month);
      const confirmed = run.confirm(input.iin, { confirmedBy: input.confirmedBy, at: ctx.today });
      if (!confirmed.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: confirmed.error.message });
      return { сообщение: `Расчёт по ${confirmed.value.fullName} подтверждён.`, строка: lineDto(confirmed.value) };
    }),

  /** «Подтвердить все и начислить»: подтверждает строки и проводит начисление в реестр. */
  confirmAllAndAccrue: t.procedure
    .input(monthInput.extend({ confirmedBy: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await payrollRun(ctx, input.month);
      run.confirmAll({ confirmedBy: input.confirmedBy, at: ctx.today });
      const entryInput = run.accrualEntryInput({ date: run.month.end() });
      if (!entryInput.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: entryInput.error.message });
      const ws = await accountingWorkspace(ctx);
      const s = run.summary();

      // Начисление за месяц идемпотентно: проводка одна на месяц
      // (payroll-<company>-<month>). Если уже начислено — не падаем
      // на DUPLICATE_ID, а сообщаем об этом.
      const existing = ws.ledger.entry(entryInput.value.id);
      if (existing !== null) {
        return {
          уже: true as const,
          сообщение: `Зарплата за ${run.month.code()} уже начислена (проводка ${existing.id}).`,
          entryId: existing.id,
          проводка: existing.lines.map((l) => ({
            счёт: l.account,
            сторона: l.side === 'DEBIT' ? 'Дт' : 'Кт',
            сумма: money(l.amount),
          })),
        };
      }

      const posted = ws.ledger.post(entryInput.value);
      if (!posted.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: posted.error.message });
      await persistLedger(ctx, ws);
      return {
        уже: false as const,
        сообщение: `Начислено за ${run.month.code()}: ${s.totalGross.toDecimalString()} ₸ по ${s.employees} сотрудникам.`,
        entryId: posted.value.id,
        проводка: posted.value.lines.map((l) => ({
          счёт: l.account,
          сторона: l.side === 'DEBIT' ? 'Дт' : 'Кт',
          сумма: money(l.amount),
        })),
      };
    }),
});
