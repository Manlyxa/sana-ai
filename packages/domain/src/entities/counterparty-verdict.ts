import { CRITICAL_RISK_FLAGS, type Counterparty, type RiskFlag } from './counterparty';

/**
 * Вердикт проверки контрагента (§7, экраны «Контрагенты» и «Проверка
 * контрагента»): есть риск / нет риска + причина человеческим языком +
 * норма НК. Чтение реестра, без записи.
 */

const FLAG_TEXT: Record<RiskFlag, string> = {
  LZHEPREDPRIYATIE: 'признан лжепредприятием — вычеты и зачёт НДС по сделкам снимаются',
  E_TAMGA: 'отметка e-Tamga (ограничение выписки ЭСФ)',
  TAX_DEBT: 'налоговая задолженность',
  BANKRUPTCY: 'процедура банкротства',
  OKED_MISMATCH: 'операции не соответствуют заявленному ОКЭД',
  INACTIVE: 'признан бездействующим налогоплательщиком',
};

/** Порог riskScore, с которого контрагент считается рисковым и без флагов. */
export const RISK_SCORE_THRESHOLD = 70;

export type CounterpartyVerdict = {
  readonly bin: string;
  readonly name: string;
  readonly risky: boolean;
  readonly critical: boolean;
  /** Причины по-русски; пусто, если признаков риска нет. */
  readonly reasons: readonly string[];
  /** Норма НК — только когда есть риск. */
  readonly norm: string | null;
  readonly riskScore: number;
  readonly lastCheckedAt: string | null;
};

export function counterpartyVerdict(cp: Counterparty): CounterpartyVerdict {
  const reasons = cp.riskFlags.map((f) => FLAG_TEXT[f]);
  if (cp.riskFlags.length === 0 && cp.riskScore >= RISK_SCORE_THRESHOLD) {
    reasons.push(`высокий скоринг риска КГД (${cp.riskScore}/100)`);
  }
  const risky = reasons.length > 0;
  return {
    bin: cp.bin.value,
    name: cp.name,
    risky,
    critical: cp.riskFlags.some((f) => CRITICAL_RISK_FLAGS.includes(f)),
    reasons,
    norm: risky ? 'ст. 264 НК РК — расходы по сделкам с рисковыми контрагентами не подлежат вычету' : null,
    riskScore: cp.riskScore,
    lastCheckedAt: cp.lastCheckedAt?.toISO() ?? null,
  };
}
