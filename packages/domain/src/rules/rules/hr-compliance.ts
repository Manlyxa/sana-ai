import { addWorkingDays } from '../../kernel/local-date';
import { isActiveOn } from '../../entities/employee';
import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

/** Трудовое право: регистрация договоров в ЕСУТД и окончательный расчёт. */

const ESUTD_ID = 'EMPLOYMENT_CONTRACT_NOT_REGISTERED';
const ESUTD_NORM = 'ст. 35 ТК РК (регистрация в ЕСУТД; срок — TODO_VERIFY)';

export const employmentContractNotRegistered = defineRule({
  id: ESUTD_ID,
  severity: 'MEDIUM',
  norm: ESUTD_NORM,
  evaluate: (ctx, asOf) =>
    ctx.employees
      .filter((e) => {
        if (!isActiveOn(e, asOf) || e.esutdRegisteredAt !== null) return false;
        const deadline = addWorkingDays(e.hiredAt, ctx.law.esutdRegistrationWorkingDays, ctx.law.holidays);
        return asOf.isAfter(deadline);
      })
      .map((e) => {
        const fine = ctx.law.mrp.multiply(ctx.law.fineEsutdMrp);
        return makeFinding(ctx, asOf, {
          ruleId: ESUTD_ID,
          severity: 'MEDIUM',
          norm: ESUTD_NORM,
          subjectId: e.iin.value,
          exposure: fine,
          message: `Трудовой договор с ${e.fullName} (принят ${e.hiredAt.toISO()}) не зарегистрирован в ЕСУТД. Риск штрафа ${formatTenge(fine)}.`,
          sourceDocuments: [{ system: 'ЕСУТД', documentType: 'трудовой договор', documentId: e.iin.value }],
          remediation: {
            kind: 'REGISTER_ESUTD',
            description: 'Зарегистрировать трудовой договор в ЕСУТД',
            autonomyLevel: 'A2',
          },
        });
      }),
});

const SETTLEMENT_ID = 'FINAL_SETTLEMENT_OVERDUE';
const SETTLEMENT_NORM = 'ст. 113 ТК РК (окончательный расчёт — 3 рабочих дня)';

export const finalSettlementOverdue = defineRule({
  id: SETTLEMENT_ID,
  severity: 'HIGH',
  norm: SETTLEMENT_NORM,
  evaluate: (ctx, asOf) =>
    ctx.finalSettlements
      .filter((s) => {
        if (s.paidAt !== null) return false;
        const deadline = addWorkingDays(s.terminatedAt, 3, ctx.law.holidays);
        return asOf.isAfter(deadline);
      })
      .map((s) =>
        makeFinding(ctx, asOf, {
          ruleId: SETTLEMENT_ID,
          severity: 'HIGH',
          norm: SETTLEMENT_NORM,
          subjectId: s.employeeIin.value,
          exposure: s.amountDue,
          message: `Окончательный расчёт ${formatTenge(s.amountDue)} по уволенному (ИИН ${s.employeeIin.value}, уволен ${s.terminatedAt.toISO()}) не выплачен в 3 рабочих дня. Пеня и штраф по ТК РК.`,
          sourceDocuments: [{ system: '1С', documentType: 'окончательный расчёт', documentId: s.employeeIin.value }],
          remediation: {
            kind: 'PAY_FINAL_SETTLEMENT',
            description: 'Сформировать платёж окончательного расчёта (требуется ЭЦП)',
            autonomyLevel: 'A1',
          },
        }),
      ),
});
