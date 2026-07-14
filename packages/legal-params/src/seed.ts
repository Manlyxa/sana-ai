import { LocalDate, Money, Rate, unwrap } from '@sana/domain';
import { LegalParameterStore, type LegalParameterInput } from './store';

/**
 * Начальные значения параметров законодательства РК.
 *
 * Все значения 2026 года действуют с 2026-01-01 (новый НК РК).
 * Исторические значения 2025 года включены там, где они нужны для
 * пересчёта прошлых периодов и для доказательства темпоральности
 * (НДС 12% → 16%).
 *
 * Параметры с todoVerify: true (§10) закодированы по лучшим доступным
 * данным, но НЕ ДОЛЖНЫ использоваться в расчётах без подтверждения
 * экспертом. Отчёт: renderTodoVerifyReport().
 */

const D = (iso: string): LocalDate => unwrap(LocalDate.parse(iso));
const FROM_2026 = D('2026-01-01');
const END_2025 = D('2025-12-31');

const NK_2026 = 'Налоговый кодекс РК (введён в действие с 01.01.2026)';
const BUDGET_LAW_2026 = 'Закон РК о республиканском бюджете на 2026–2028 годы';
const BUDGET_LAW_2025 = 'Закон РК о республиканском бюджете на 2025–2027 годы';
const SOC_CODEX = 'Социальный кодекс РК';
const OSMS_LAW = 'Закон РК «Об обязательном социальном медицинском страховании»';

export const SEED_PARAMETERS: readonly LegalParameterInput<unknown>[] = [
  // -------------------------------------------------------------------------
  // Базовые показатели
  // -------------------------------------------------------------------------
  {
    key: 'mrp',
    value: Money.ofMajor(3_932),
    validFrom: D('2025-01-01'),
    validTo: END_2025,
    norm: 'ст. 9 Закона о республиканском бюджете',
    source: BUDGET_LAW_2025,
    todoVerify: false,
  },
  {
    key: 'mrp',
    value: Money.ofMajor(4_325),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 9 Закона о республиканском бюджете',
    source: BUDGET_LAW_2026,
    todoVerify: false,
  },
  {
    key: 'mzp',
    value: Money.ofMajor(85_000),
    validFrom: D('2025-01-01'),
    validTo: END_2025,
    norm: 'ст. 9 Закона о республиканском бюджете',
    source: BUDGET_LAW_2025,
    todoVerify: false,
  },
  {
    key: 'mzp',
    value: Money.ofMajor(85_000),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 9 Закона о республиканском бюджете',
    source: BUDGET_LAW_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // НДС
  // -------------------------------------------------------------------------
  {
    key: 'vat.rate.standard',
    value: Rate.percent(12),
    validFrom: D('2009-01-01'),
    validTo: END_2025,
    norm: 'ст. 422 НК РК (ред. до 2026)',
    source: 'Кодекс РК от 25.12.2017 № 120-VI',
    todoVerify: false,
  },
  {
    key: 'vat.rate.standard',
    value: Rate.percent(16),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 484 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'vat.rate.reduced.medical',
    value: Rate.percent(5),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 484 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'vat.rate.export',
    value: Rate.percent(0),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 486 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'vat.registration.threshold.mrp',
    value: 10_000,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 99 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'vat.registration.application.days',
    value: { days: 5, kind: 'WORKING' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 99 НК РК',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // КПН
  // -------------------------------------------------------------------------
  {
    key: 'kpn.rate.standard',
    value: Rate.percent(20),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 313 НК РК',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // ИПН
  // -------------------------------------------------------------------------
  {
    key: 'ipn.bracket1.rate',
    value: Rate.percent(10),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 320 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'ipn.bracket1.ceiling.mrp',
    value: 8_500,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 320 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'ipn.bracket2.rate',
    value: Rate.percent(15),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 320 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'ipn.standard.deduction',
    value: { mrpPerMonth: 30, mrpAnnualMax: 360, requiresApplication: true },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 346 НК РК',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // Социальные платежи (работник)
  // -------------------------------------------------------------------------
  {
    key: 'opv',
    value: { rate: Rate.percent(10), capMzp: 50 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 249 Социального кодекса РК',
    source: SOC_CODEX,
    todoVerify: false,
  },
  {
    key: 'vosms',
    value: { rate: Rate.percent(2), capMzp: 20 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 28 Закона об ОСМС',
    source: OSMS_LAW,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // Социальные платежи (работодатель)
  // -------------------------------------------------------------------------
  {
    key: 'opvr',
    value: { rate: Rate.percent('3.5'), capMzp: 50, exemptIfBornBefore: D('1975-01-01') },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 251 Социального кодекса РК',
    source: SOC_CODEX,
    todoVerify: false,
  },
  {
    key: 'so',
    value: { rate: Rate.percent(5), base: 'GROSS_MINUS_OPV', floorMzp: 1, capMzp: 7 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 243 Социального кодекса РК',
    source: SOC_CODEX,
    todoVerify: false,
  },
  {
    key: 'oosms',
    value: { rate: Rate.percent(3), capMzp: 40 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 27 Закона об ОСМС',
    source: OSMS_LAW,
    todoVerify: false,
  },
  {
    key: 'sn',
    value: { rate: Rate.percent(6), base: 'GROSS_MINUS_OPV_MINUS_VOSMS', soOffset: false },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 485–486 НК РК (соцналог; зачёт СО отменён с 2026)',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // СНР
  // -------------------------------------------------------------------------
  {
    key: 'snr.uproshchenka.rate',
    value: Rate.percent(4),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 727 НК РК (маслихат вправе менять в пределах 2–6%)',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'snr.uproshchenka.income.limit.mrp',
    value: 600_000,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 722 НК РК',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // ЭСФ
  // -------------------------------------------------------------------------
  {
    key: 'esf.issue.deadline',
    value: { days: 15, kind: 'CALENDAR' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 493 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'esf.nonresident.deadline',
    value: { days: 5, kind: 'CALENDAR' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'п. 9 ст. 493 НК РК',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // Сроки ФНО и уплаты
  // -------------------------------------------------------------------------
  {
    key: 'fno.300.filing.window',
    value: {
      opens: { monthsAfterPeriodEnd: 1, dayOfMonth: 15 },
      closes: { monthsAfterPeriodEnd: 2, dayOfMonth: 15 },
    },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 505 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'fno.300.payment.due',
    value: { monthsAfterPeriodEnd: 2, dayOfMonth: 25 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 506 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'fno.200.filing.due',
    value: { monthsAfterPeriodEnd: 2, dayOfMonth: 15 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 489 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    // Год заканчивается 31.12 → +3 месяца, день 31 = 31 марта.
    key: 'fno.100.filing.due',
    value: { monthsAfterPeriodEnd: 3, dayOfMonth: 31 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 314 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    // Полугодие: 30.06 → +2 мес, 15-е = 15 августа; 31.12 → 15 февраля.
    key: 'fno.910.filing.due',
    value: { monthsAfterPeriodEnd: 2, dayOfMonth: 15 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 728 НК РК',
    source: NK_2026,
    todoVerify: false,
  },
  {
    key: 'payroll.taxes.payment.due',
    value: { monthsAfterPeriodEnd: 1, dayOfMonth: 25 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 321, 487 НК РК; ст. 245, 250 Социального кодекса РК',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // Уведомления КГД
  // -------------------------------------------------------------------------
  {
    key: 'kgd.notice.response.days',
    value: { days: 30, kind: 'WORKING' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'НК РК — исполнение уведомлений КГД',
    source: NK_2026,
    todoVerify: false,
  },

  // -------------------------------------------------------------------------
  // §10 и штрафы КоАП — ЗАКОДИРОВАНО ПО ЛУЧШИМ ДАННЫМ, ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ
  // -------------------------------------------------------------------------
  {
    key: 'ipn.additional.deduction.mrp',
    value: { disabilityAnnual: 882, privilegedAnnual: 5_000 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 346 НК РК — дополнительные вычеты (882/5000 МРП) — подтвердить охват категорий',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'koap.esf.nonissue.fine.mrp',
    value: 40,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 280-1 КоАП РК — невыписка ЭСФ (размер для среднего бизнеса не подтверждён)',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'koap.fno.late.fine.mrp',
    value: 30,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 272 КоАП РК — непредставление ФНО (размер не подтверждён)',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'koap.esutd.fine.mrp',
    value: 30,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'КоАП РК — нарушение регистрации трудовых договоров (размер не подтверждён)',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'koap.vat.registration.fine.mrp',
    value: 50,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 269 КоАП РК — несвоевременная постановка на учёт по НДС (50 МРП, не подтверждён)',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'calendar.holidays',
    value: [
      '2026-01-01', '2026-01-02', '2026-01-07',
      '2026-03-08', '2026-03-21', '2026-03-22', '2026-03-23',
      '2026-05-01', '2026-05-07', '2026-05-09',
      '2026-07-06', '2026-08-30', '2026-10-25', '2026-12-16',
    ],
    validFrom: FROM_2026,
    validTo: D('2026-12-31'),
    norm: 'ст. 84 ТК РК — праздничные дни (переносы выходных не учтены)',
    source: 'подтвердить у эксперта (постановления о переносах)',
    todoVerify: true,
  },
  {
    key: 'ipn.dividends',
    value: { rate: Rate.percent(5), ceilingMrp: 230_000 },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 320 НК РК — ИСТОЧНИКИ ПРОТИВОРЕЧАТ (5% или 10%)',
    source: 'КОНФЛИКТ ИСТОЧНИКОВ — подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'unified.payment.rate',
    value: Rate.percent('24.8'),
    validFrom: FROM_2026,
    validTo: null,
    norm: 'единый платёж с ФОТ — круг применяющих в 2026 не подтверждён',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'esutd.registration.deadline',
    value: { days: 5, kind: 'WORKING' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 35 ТК РК — срок регистрации в ЕСУТД не подтверждён',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'cash.settlement.limit.mrp',
    value: 1_000,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'ст. 25 Закона о платежах и платёжных системах — лимит не подтверждён',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'kpn.loss.carryforward.years',
    value: 10,
    validFrom: FROM_2026,
    validTo: null,
    norm: 'перенос убытков по НК РК 2026 — срок не подтверждён',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'kpn.depreciation.norms',
    value: {
      I: Rate.percent(10),
      II: Rate.percent(25),
      III: Rate.percent(40),
      IV: Rate.percent(15),
    },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'нормы амортизации групп I–IV и лимит последующих расходов по НК РК 2026 — не подтверждены',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'snr.supplier.deduction.ban',
    value: { scope: 'Точный охват запрета вычета расходов от поставщиков на СНР не подтверждён' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'НК РК 2026 — вычеты по КПН',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
  {
    key: 'audit.mandatory.thresholds',
    value: { description: 'Пороги обязательного аудита по Закону об аудиторской деятельности — не подтверждены' },
    validFrom: FROM_2026,
    validTo: null,
    norm: 'Закон РК «Об аудиторской деятельности»',
    source: 'подтвердить у эксперта',
    todoVerify: true,
  },
];

/** Хранилище с начальными данными. Бросает, если seed внутренне некорректен. */
export function createSeededStore(): LegalParameterStore {
  const result = LegalParameterStore.create(SEED_PARAMETERS);
  if (!result.ok) {
    throw new Error(`SEED_PARAMETERS некорректны: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
