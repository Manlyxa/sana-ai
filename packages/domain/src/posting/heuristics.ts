import type { BankTransactionPayload } from '../ledger/business-event';
import type { AccountSuggestion } from './proposal';

/**
 * Built-in bank transaction classification (Module 2):
 *  - deterministic rules (КНП codes) — confidence 100;
 *  - keyword heuristics over the payment purpose — confidence < 100.
 *
 * Both are pure functions: same input → same suggestion, always.
 */

export type BankClassification = AccountSuggestion & {
  /** true — однозначное детерминированное правило (КНП). */
  readonly deterministic: boolean;
};

/** КНП групп выплат зарплаты (платежи на карт-счета работников). */
const SALARY_KNP: ReadonlySet<string> = new Set(['711', '712', '713']);
/** КНП уплаты налогов и других обязательных платежей в бюджет. */
const TAX_KNP: ReadonlySet<string> = new Set(['911', '912', '913']);

type Keyword = {
  readonly needle: string;
  readonly suggest: (p: BankTransactionPayload) => BankClassification;
};

const DEBIT_KEYWORDS: readonly Keyword[] = [
  {
    needle: 'аренд',
    suggest: () => ({
      debitAccount: '7210',
      creditAccount: '1030',
      category: 'АРЕНДА',
      confidence: 85,
      explanation: 'В назначении платежа упомянута аренда — административные расходы (счёт 7210).',
      deterministic: false,
    }),
  },
  {
    needle: 'зарплат',
    suggest: () => ({
      debitAccount: '3350',
      creditAccount: '1030',
      category: 'ОПЛАТА_ТРУДА',
      confidence: 85,
      explanation: 'В назначении платежа упомянута зарплата — погашение задолженности по оплате труда (счёт 3350).',
      deterministic: false,
    }),
  },
  {
    needle: 'налог',
    suggest: () => ({
      debitAccount: '3190',
      creditAccount: '1030',
      category: 'НАЛОГИ',
      confidence: 80,
      explanation: 'В назначении платежа упомянут налог — уплата налогов в бюджет (счёт 3190).',
      deterministic: false,
    }),
  },
  {
    needle: 'услуг',
    suggest: () => ({
      debitAccount: '7210',
      creditAccount: '1030',
      category: 'УСЛУГИ',
      confidence: 70,
      explanation: 'Похоже на оплату услуг — административные расходы (счёт 7210).',
      deterministic: false,
    }),
  },
];

export function classifyBankTransaction(payload: BankTransactionPayload): BankClassification {
  if (payload.direction === 'DEBIT') {
    if (payload.knp !== null && SALARY_KNP.has(payload.knp)) {
      return {
        debitAccount: '3350',
        creditAccount: '1030',
        category: 'ОПЛАТА_ТРУДА',
        confidence: 100,
        explanation: `КНП ${payload.knp} — выплата заработной платы: Дт 3350 Кт 1030.`,
        deterministic: true,
      };
    }
    if (payload.knp !== null && TAX_KNP.has(payload.knp)) {
      return {
        debitAccount: '3190',
        creditAccount: '1030',
        category: 'НАЛОГИ',
        confidence: 100,
        explanation: `КНП ${payload.knp} — уплата налогов и платежей в бюджет: Дт 3190 Кт 1030.`,
        deterministic: true,
      };
    }
    const purpose = payload.purposeText.toLowerCase();
    for (const kw of DEBIT_KEYWORDS) {
      if (purpose.includes(kw.needle)) return kw.suggest(payload);
    }
    return {
      debitAccount: '3310',
      creditAccount: '1030',
      category: null,
      confidence: 55,
      explanation: 'Назначение платежа не распознано — предположительно оплата поставщику (Дт 3310 Кт 1030).',
      deterministic: false,
    };
  }
  // Поступление на счёт.
  const purpose = payload.purposeText.toLowerCase();
  if (purpose.includes('займ') || purpose.includes('кредит')) {
    return {
      debitAccount: '1030',
      creditAccount: '4030',
      category: 'ЗАЙМЫ',
      confidence: 75,
      explanation: 'В назначении платежа упомянут займ — получение заёмных средств (Кт 4030).',
      deterministic: false,
    };
  }
  if (purpose.includes('оплата') || purpose.includes('за товар') || purpose.includes('по договору')) {
    return {
      debitAccount: '1030',
      creditAccount: '1210',
      category: 'ВЫРУЧКА',
      confidence: 80,
      explanation: 'Похоже на оплату от покупателя — погашение дебиторской задолженности (Кт 1210).',
      deterministic: false,
    };
  }
  return {
    debitAccount: '1030',
    creditAccount: '1210',
    category: null,
    confidence: 60,
    explanation: 'Назначение поступления не распознано — предположительно оплата от покупателя (Кт 1210).',
    deterministic: false,
  };
}
