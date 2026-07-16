import { findCounterparty } from '../context';
import { defineRule } from '../types';
import { formatTenge, invoiceDocRef, makeFinding } from '../helpers';

const ID = 'SNR_SUPPLIER_DEDUCTION';
const NORM = 'НК РК 2026 — вычеты по КПН (точный охват запрета: TODO_VERIFY)';

/**
 * Расход от поставщика на СНР отнесён на вычеты по КПН — не подлежит вычету
 * по НК РК 2026. Экспозиция = КПН 20% × сумма расхода.
 */
export const snrSupplierDeduction = defineRule({
  id: ID,
  severity: 'HIGH',
  norm: NORM,
  evaluate: (ctx, asOf) => {
    if (ctx.company.taxRegime !== 'ОУР') return [];
    return ctx.invoices
      .filter((inv) => inv.direction === 'IN' && inv.status !== 'АННУЛИРОВАН' && inv.status !== 'ОТОЗВАН')
      .flatMap((inv) => {
        const cp = findCounterparty(ctx, inv.counterpartyBin);
        if (cp === undefined || !cp.taxRegime.startsWith('СНР')) return [];
        const exposure = inv.totalExVat.percent(ctx.law.kpnRate);
        return [
          makeFinding(ctx, asOf, {
            ruleId: ID,
            severity: 'HIGH',
            norm: NORM,
            subjectId: inv.id,
            exposure,
            message: `Поставщик ${cp.name} применяет СНР (${cp.taxRegime}): расход ${formatTenge(inv.totalExVat)} по ЭСФ № ${inv.number} не подлежит вычету по КПН. Риск доначисления ${formatTenge(exposure)}.`,
            sourceDocuments: [invoiceDocRef(inv.number)],
            remediation: {
              kind: 'EXCLUDE_FROM_DEDUCTIONS',
              description: 'Исключить расход из вычетов по КПН при подготовке ф.100',
              autonomyLevel: 'A2',
            },
          }),
        ];
      });
  },
});
