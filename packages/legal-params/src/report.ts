import type { LegalParameterStore } from './store';

/**
 * Markdown-отчёт по параметрам, требующим подтверждения экспертом (§10).
 * Выводится в консоль при старте dev-стека и прикладывается к онбордингу
 * налогового эксперта.
 */
export function renderTodoVerifyReport(store: LegalParameterStore): string {
  const records = store.todoVerify();
  const lines: string[] = [
    '# Параметры, требующие подтверждения экспертом',
    '',
    'Эти значения закодированы по лучшим доступным данным и **не должны**',
    'использоваться в боевых расчётах до подтверждения налоговым экспертом.',
    '',
    '| Ключ | Действует с | Норма | Источник |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of records) {
    lines.push(`| \`${r.key}\` | ${r.validFrom.toISO()} | ${r.norm} | ${r.source} |`);
  }
  lines.push('', `Всего: ${records.length}.`, '');
  return lines.join('\n');
}
