import { hasCriticalRiskFlag } from '../../entities/counterparty';
import { findCounterparty } from '../context';
import { defineRule } from '../types';
import { formatTenge, invoiceDocRef, makeFinding } from '../helpers';

const ID = 'COUNTERPARTY_HIGH_RISK';
const NORM = 'ст. 264, 403 НК РК (вычеты и зачёт по фиктивным сделкам)';

/**
 * Сделка с контрагентом-лжепредприятием / e-Tamga / несоответствие ОКЭД.
 * Экспозиция — доначисления: снятый зачёт НДС + КПН 20% с вычета.
 */
export const counterpartyHighRisk = defineRule({
  id: ID,
  severity: 'CRITICAL',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.invoices
      .filter((inv) => inv.direction === 'IN' && inv.status !== 'АННУЛИРОВАН' && inv.status !== 'ОТОЗВАН')
      .flatMap((inv) => {
        const cp = findCounterparty(ctx, inv.counterpartyBin);
        if (cp === undefined) return [];
        const risky = hasCriticalRiskFlag(cp) || cp.riskFlags.includes('OKED_MISMATCH');
        if (!risky) return [];
        const exposure = inv.vatAmount.add(inv.totalExVat.percent(ctx.law.kpnRate));
        const flags = cp.riskFlags.join(', ');
        return [
          makeFinding(ctx, asOf, {
            ruleId: ID,
            severity: 'CRITICAL',
            norm: NORM,
            subjectId: inv.id,
            exposure,
            message: `Сделка с рисковым контрагентом ${cp.name} (флаги: ${flags}) по ЭСФ № ${inv.number}. Риск доначислений ${formatTenge(exposure)}: снятие зачёта НДС и вычета по КПН.`,
            sourceDocuments: [invoiceDocRef(inv.number)],
            remediation: {
              kind: 'REVIEW_RISKY_TRANSACTION',
              description: 'Оценить сделку и позицию по вычетам с налоговым консультантом',
              autonomyLevel: 'A0',
            },
          }),
        ];
      }),
});
