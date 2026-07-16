import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_DESCRIPTIONS,
  AUTONOMY_LEVELS,
  isMachineExecutable,
  requiresConfirmation,
  requiresSignature,
} from './autonomy-level';

describe('AutonomyLevel (P6)', () => {
  it('четыре уровня, у каждого — описание', () => {
    expect(AUTONOMY_LEVELS).toEqual(['A0', 'A1', 'A2', 'A3']);
    for (const level of AUTONOMY_LEVELS) {
      expect(AUTONOMY_DESCRIPTIONS[level]).toBeTruthy();
    }
  });

  it('A1 требует подписи; A2 — подтверждения; A3 — автономен; A0 — только человек', () => {
    expect(requiresSignature('A1')).toBe(true);
    expect(requiresSignature('A2')).toBe(false);
    expect(requiresSignature('A3')).toBe(false);

    expect(requiresConfirmation('A1')).toBe(true);
    expect(requiresConfirmation('A2')).toBe(true);
    expect(requiresConfirmation('A3')).toBe(false);

    expect(isMachineExecutable('A0')).toBe(false);
    expect(isMachineExecutable('A3')).toBe(true);
  });
});
