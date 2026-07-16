/**
 * Все строки интерфейса — в словаре (проект i18n с первого дня;
 * казахский появится вторым словарём с теми же ключами).
 */
export const STR = {
  appName: 'Sana Guard',
  tagline: 'Комплаенс-страж вашего ТОО',
  totalAtRisk: 'Всего под риском',
  openFindings: 'открытых рисков',
  refreshCheck: 'Проверить сейчас',
  norm: 'Норма',
  sourceDocuments: 'Документы-основания',
  parameterVersion: 'Версия параметров закона',
  remediation: 'Что сделает Sana',
  severity: {
    CRITICAL: 'Критично',
    HIGH: 'Высокий риск',
    MEDIUM: 'Средний риск',
    INFO: 'К сведению',
  },
  autonomy: {
    A3: 'исполняется автоматически',
    A2: 'нужно ваше подтверждение',
    A1: 'нужна ваша ЭЦП',
    A0: 'только решение человека',
  },
  action: {
    A3: 'Исполнить',
    A2: 'Подтвердить и исполнить',
    A1: 'Запросить ЭЦП',
    A0: 'Обсудить с консультантом',
  },
  emptyFeed: 'Рисков не обнаружено. Sana следит дальше.',
  signatureRequested:
    'Запрос на подпись отправлен владельцу. В проде: NCALayer / eGov Mobile QR. Ключ ЭЦП никогда не покидает владельца.',
  vatStatus: { registered: 'Плательщик НДС', notRegistered: 'Не плательщик НДС' },
  employees: 'работников',
  ledgerLine: (events: number, journal: number, registers: number) =>
    `Теневой регистр: ${events} событий · ${journal} проводок · ${registers} записей налоговых регистров`,
} as const;
