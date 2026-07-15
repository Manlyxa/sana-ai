import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { authorizeExecution, type Finding } from '@sana/domain';
import { runAndPersistComplianceCheck } from '@sana/app';
import type { ApiContext } from './context';

/**
 * tRPC API. Лента рисков отдаётся в тенге под риском (§7: не «задачи»,
 * а деньги); каждое исполнение ремедиации проходит через единый
 * autonomy guard (P6).
 */

const t = initTRPC.context<ApiContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

function findingToDto(f: Finding) {
  return {
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    asOf: f.asOf.toISO(),
    /** Тенге под риском — драйвер UI. */
    exposureTiyn: f.exposure.amount.toString(),
    exposureTenge: f.exposure.roundToMajor().toDecimalString(),
    message: f.message,
    norm: f.justification.norm,
    sourceDocuments: f.justification.sourceDocuments,
    parameterVersion: f.justification.parameterVersion,
    remediation: f.remediation,
  };
}

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok' as const })),

  company: publicProcedure.query(({ ctx }) => ({
    id: ctx.company.id,
    bin: ctx.company.bin.value,
    name: ctx.company.name,
    taxRegime: ctx.company.taxRegime,
    vatRegistered: ctx.company.vatStatus.registered,
    employeeCount: ctx.company.employeeCount,
  })),

  /** Прогнать комплаенс-проверку: порты → теневой регистр → правила → БД. */
  runCheck: publicProcedure.mutation(async ({ ctx }) => {
    const result = await runAndPersistComplianceCheck(ctx.ports, ctx.repos, {
      company: ctx.company,
      accountIban: ctx.accountIban,
      law: ctx.law,
      asOf: ctx.today,
    });
    if (!result.ok) {
      throw new TRPCError({ code: 'BAD_GATEWAY', message: result.error.message });
    }
    const { eventsIngested, journalEntries, taxRegisterEntries, findings } = result.value;
    return { eventsIngested, journalEntries, taxRegisterEntries, findings };
  }),

  /** Лента рисков: открытые находки по убыванию тенге под риском. */
  riskFeed: publicProcedure.query(async ({ ctx }) => {
    const findings = await ctx.repos.findings.listOpen(ctx.company.id);
    if (!findings.ok) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: findings.error });
    }
    return findings.value.map(findingToDto);
  }),

  /** Теневой регистр и проекции — для проверки полноты данных. */
  ledger: publicProcedure.query(async ({ ctx }) => {
    const [events, journal, registers] = await Promise.all([
      ctx.repos.events.count(ctx.company.id),
      ctx.repos.ledger.listJournal(ctx.company.id),
      ctx.repos.ledger.listTaxRegisters(ctx.company.id),
    ]);
    if (!journal.ok || !registers.ok) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'повреждены проекции' });
    }
    return {
      events,
      journalEntries: journal.value.length,
      taxRegisterEntries: registers.value.length,
    };
  }),

  /**
   * Исполнить ремедиацию находки. Единственная дверь к исполнению —
   * autonomy guard: A3 идёт сразу, A2 требует подтверждения,
   * A1 — артефакта подписи, A0 не исполняется системой.
   */
  remediate: publicProcedure
    .input(
      z.object({
        findingId: z.string(),
        confirmation: z
          .object({ confirmedBy: z.string(), atIso: z.string() })
          .nullish(),
        signature: z
          .object({ requestId: z.string(), cmsBase64: z.string() })
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const found = await ctx.repos.findings.getOpen(input.findingId);
      if (found === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `находка ${input.findingId} не найдена или уже решена` });
      }
      if (!found.ok) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: found.error });
      }
      const finding = found.value;

      const authorized = authorizeExecution({
        actionKind: finding.remediation.kind,
        autonomyLevel: finding.remediation.autonomyLevel,
        confirmation: input.confirmation ?? null,
        signature: input.signature ?? null,
      });
      if (!authorized.ok) {
        throw new TRPCError({ code: 'FORBIDDEN', message: authorized.error.message, cause: authorized.error.reason });
      }

      // Исполнители по виду ремедиации; расширяются по мере фаз.
      switch (finding.remediation.kind) {
        case 'SEND_VAT_CREDIT_NOTICE': {
          const invoiceId = finding.justification.sourceDocuments[0]?.documentId;
          if (invoiceId === undefined) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'нет документа-основания' });
          }
          const sent = await ctx.ports.esf.sendVatCreditNotice(invoiceId);
          if (!sent.ok) {
            throw new TRPCError({ code: 'BAD_GATEWAY', message: sent.error.message });
          }
          return { executed: true as const, action: finding.remediation.kind, documentId: invoiceId };
        }
        case 'CONFIRM_ESF': {
          const invoiceId = finding.justification.sourceDocuments[0]?.documentId;
          if (invoiceId === undefined) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'нет документа-основания' });
          }
          const confirmed = await ctx.ports.esf.confirmInvoice(invoiceId);
          if (!confirmed.ok) {
            throw new TRPCError({ code: 'BAD_GATEWAY', message: confirmed.error.message });
          }
          return { executed: true as const, action: finding.remediation.kind, documentId: invoiceId };
        }
        default:
          throw new TRPCError({
            code: 'NOT_IMPLEMENTED',
            message: `исполнитель «${finding.remediation.kind}» появится в следующих фазах`,
          });
      }
    }),
});

export type AppRouter = typeof appRouter;
