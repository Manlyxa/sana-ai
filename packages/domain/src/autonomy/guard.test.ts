import { describe, expect, it } from 'vitest';
import { authorizeExecution, type ExecutionRequest } from './guard';

function request(overrides: Partial<ExecutionRequest>): ExecutionRequest {
  return {
    actionKind: 'TEST_ACTION',
    autonomyLevel: 'A3',
    confirmation: null,
    signature: null,
    ...overrides,
  };
}

describe('authorizeExecution (P6)', () => {
  it('A3 исполняется автономно', () => {
    expect(authorizeExecution(request({ autonomyLevel: 'A3' })).ok).toBe(true);
  });

  it('A2 требует подтверждения в приложении', () => {
    const denied = authorizeExecution(request({ autonomyLevel: 'A2' }));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.reason).toBe('CONFIRMATION_REQUIRED');

    const allowed = authorizeExecution(
      request({
        autonomyLevel: 'A2',
        confirmation: { confirmedBy: 'owner@too.kz', atIso: '2026-05-10T10:00:00+05:00' },
      }),
    );
    expect(allowed.ok).toBe(true);
  });

  it('НЕВОЗМОЖНО исполнить A1 без артефакта подписи', () => {
    const noSignature = authorizeExecution(request({ autonomyLevel: 'A1' }));
    expect(noSignature.ok).toBe(false);
    if (!noSignature.ok) expect(noSignature.error.reason).toBe('SIGNATURE_REQUIRED');

    const emptyCms = authorizeExecution(
      request({ autonomyLevel: 'A1', signature: { requestId: 'r1', cmsBase64: '  ' } }),
    );
    expect(emptyCms.ok).toBe(false);

    const signed = authorizeExecution(
      request({ autonomyLevel: 'A1', signature: { requestId: 'r1', cmsBase64: 'TU9DSw==' } }),
    );
    expect(signed.ok).toBe(true);
  });

  it('A0 система не исполняет никогда — даже с подписью и подтверждением', () => {
    const denied = authorizeExecution(
      request({
        autonomyLevel: 'A0',
        confirmation: { confirmedBy: 'owner', atIso: '2026-05-10T10:00:00+05:00' },
        signature: { requestId: 'r1', cmsBase64: 'TU9DSw==' },
      }),
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.reason).toBe('HUMAN_ONLY');
  });
});
