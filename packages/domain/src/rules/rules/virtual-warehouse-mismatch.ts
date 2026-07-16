import { defineRule } from '../types';
import { formatTenge, makeFinding } from '../helpers';

const ID = 'VIRTUAL_WAREHOUSE_MISMATCH';
const NORM = 'Правила ИС ЭСФ — модуль «Виртуальный склад»';

/**
 * Остатки ИС «Виртуальный склад» ≠ нашему регистру → выписка СНТ будет
 * заблокирована. Экспозиция — стоимость расхождения.
 */
export const virtualWarehouseMismatch = defineRule({
  id: ID,
  severity: 'HIGH',
  norm: NORM,
  evaluate: (ctx, asOf) =>
    ctx.virtualWarehouse
      .filter((b) => b.vsQuantity !== b.ledgerQuantity)
      .map((b) => {
        const diff = Math.abs(b.vsQuantity - b.ledgerQuantity);
        const exposure = b.unitValue.multiply(diff);
        return makeFinding(ctx, asOf, {
          ruleId: ID,
          severity: 'HIGH',
          norm: NORM,
          subjectId: b.productCode,
          exposure,
          message: `Расхождение по «${b.name}» (${b.productCode}): ИС ВС ${b.vsQuantity} против учёта ${b.ledgerQuantity}. Блокирует выписку СНТ; стоимость расхождения ${formatTenge(exposure)}.`,
          sourceDocuments: [{ system: 'ИС_ЭСФ', documentType: 'остатки ВС', documentId: b.productCode }],
          remediation: {
            kind: 'RECONCILE_VIRTUAL_WAREHOUSE',
            description: 'Сверить и скорректировать остатки виртуального склада',
            autonomyLevel: 'A2',
          },
        });
      }),
});
