/**
 * Working chart of accounts — a minimal subset of the Типовой план счетов
 * бухгалтерского учёта РК (приказ МФ РК № 185) sufficient for a ТОО/ИП
 * on СНР. Account names are canonical Russian domain terms.
 *
 * The chart is versioned data: `CHART_OF_ACCOUNTS_VERSION` is referenced
 * by every ledger entry as part of its legal-parameter provenance.
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

/** The side on which the account normally carries its balance. */
export type NormalSide = 'DEBIT' | 'CREDIT';

export type AccountDefinition = {
  readonly code: string;
  /** Каноническое наименование счёта (Типовой план счетов РК). */
  readonly name: string;
  readonly type: AccountType;
  readonly normalSide: NormalSide;
};

function acc(code: string, name: string, type: AccountType): AccountDefinition {
  const normalSide: NormalSide = type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
  return { code, name, type, normalSide };
}

/** Version tag for provenance (Module 5): referenced as legalParamsVersion. */
export const CHART_OF_ACCOUNTS_VERSION = 'chart-of-accounts.snr@2026-01-01';

export const CHART_OF_ACCOUNTS: readonly AccountDefinition[] = [
  // Раздел 1 — Краткосрочные активы
  acc('1010', 'Денежные средства в кассе', 'ASSET'),
  acc('1030', 'Денежные средства на текущих банковских счетах', 'ASSET'),
  acc('1210', 'Краткосрочная дебиторская задолженность покупателей и заказчиков', 'ASSET'),
  acc('1250', 'Краткосрочная дебиторская задолженность работников', 'ASSET'),
  acc('1330', 'Товары', 'ASSET'),
  acc('1420', 'НДС к возмещению (зачёту)', 'ASSET'),
  acc('1610', 'Краткосрочные авансы выданные', 'ASSET'),
  // Раздел 2 — Долгосрочные активы
  acc('2410', 'Основные средства', 'ASSET'),
  // Раздел 3 — Краткосрочные обязательства
  acc('3110', 'Корпоративный подоходный налог, подлежащий уплате', 'LIABILITY'),
  acc('3120', 'ИПН, подлежащий уплате', 'LIABILITY'),
  acc('3130', 'НДС, подлежащий уплате', 'LIABILITY'),
  acc('3150', 'Социальный налог, подлежащий уплате', 'LIABILITY'),
  acc('3190', 'Прочие налоги и обязательные платежи в бюджет', 'LIABILITY'),
  acc('3220', 'Обязательства по пенсионным отчислениям', 'LIABILITY'),
  acc('3310', 'Краткосрочная кредиторская задолженность поставщикам и подрядчикам', 'LIABILITY'),
  acc('3350', 'Краткосрочная задолженность по оплате труда', 'LIABILITY'),
  acc('3510', 'Краткосрочные авансы полученные', 'LIABILITY'),
  // Раздел 4 — Долгосрочные обязательства
  acc('4030', 'Долгосрочные займы', 'LIABILITY'),
  // Раздел 5 — Капитал
  acc('5030', 'Вклады и паи (уставный капитал)', 'EQUITY'),
  acc('5510', 'Нераспределённая прибыль (непокрытый убыток) отчётного года', 'EQUITY'),
  acc('5520', 'Нераспределённая прибыль (непокрытый убыток) предыдущих лет', 'EQUITY'),
  // Раздел 6 — Доходы
  acc('6010', 'Доход от реализации продукции и оказания услуг', 'REVENUE'),
  acc('6280', 'Прочие доходы', 'REVENUE'),
  // Раздел 7 — Расходы
  acc('7010', 'Себестоимость реализованной продукции и оказанных услуг', 'EXPENSE'),
  acc('7110', 'Расходы по реализации продукции и оказанию услуг', 'EXPENSE'),
  acc('7210', 'Административные расходы', 'EXPENSE'),
  acc('7310', 'Расходы по вознаграждениям', 'EXPENSE'),
  acc('7470', 'Прочие расходы', 'EXPENSE'),
];

const BY_CODE: ReadonlyMap<string, AccountDefinition> = new Map(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a]),
);

export function findAccount(code: string): AccountDefinition | null {
  return BY_CODE.get(code) ?? null;
}

export function isKnownAccount(code: string): boolean {
  return BY_CODE.has(code);
}
