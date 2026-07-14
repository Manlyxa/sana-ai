/**
 * Уровни автономности (P6). Уровень — свойство типа действия, хранится в
 * конфигурации и проверяется единым guard'ом в конвейере исполнения
 * (guard — фаза 4). A1 без артефакта подписи исполнить невозможно.
 */
export const AUTONOMY_LEVELS = ['A0', 'A1', 'A2', 'A3'] as const;

export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  A3: 'Исполняется автономно, с записью в журнал',
  A2: 'Исполняется после подтверждения в приложении',
  A1: 'Готовится системой, требует ЭЦП владельца',
  A0: 'Только человек',
};

/** Действие требует артефакта подписи (ЭЦП владельца). */
export function requiresSignature(level: AutonomyLevel): boolean {
  return level === 'A1';
}

/** Действие требует подтверждения в приложении. */
export function requiresConfirmation(level: AutonomyLevel): boolean {
  return level === 'A2' || level === 'A1';
}

/** Действие вообще может быть исполнено системой. */
export function isMachineExecutable(level: AutonomyLevel): boolean {
  return level !== 'A0';
}
