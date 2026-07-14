import { err, ok, type Result } from '../kernel/result';
import type { AutonomyLevel } from './autonomy-level';

/**
 * Единый guard исполнения (P6). Каждое действие проходит через него;
 * исполнить A1 без артефакта подписи НЕВОЗМОЖНО, A2 — без подтверждения,
 * A0 система не исполняет вообще.
 */

/** Подтверждение владельца в приложении (A2). */
export type ExecutionConfirmation = {
  readonly confirmedBy: string;
  readonly atIso: string;
};

/** Ссылка на артефакт подписи ЭЦП (A1). Сам ключ не существует в системе (P4). */
export type ExecutionSignature = {
  readonly requestId: string;
  readonly cmsBase64: string;
};

export type ExecutionRequest = {
  readonly actionKind: string;
  readonly autonomyLevel: AutonomyLevel;
  readonly confirmation: ExecutionConfirmation | null;
  readonly signature: ExecutionSignature | null;
};

export type ExecutionDenial = {
  readonly reason: 'HUMAN_ONLY' | 'CONFIRMATION_REQUIRED' | 'SIGNATURE_REQUIRED';
  readonly message: string;
};

export function authorizeExecution(
  request: ExecutionRequest,
): Result<'AUTHORIZED', ExecutionDenial> {
  switch (request.autonomyLevel) {
    case 'A0':
      return err({
        reason: 'HUMAN_ONLY',
        message: `«${request.actionKind}» — уровень A0: только человек, система не исполняет`,
      });
    case 'A1': {
      if (request.signature === null || request.signature.cmsBase64.trim() === '') {
        return err({
          reason: 'SIGNATURE_REQUIRED',
          message: `«${request.actionKind}» — уровень A1: требуется ЭЦП владельца`,
        });
      }
      return ok('AUTHORIZED');
    }
    case 'A2': {
      if (request.confirmation === null) {
        return err({
          reason: 'CONFIRMATION_REQUIRED',
          message: `«${request.actionKind}» — уровень A2: требуется подтверждение в приложении`,
        });
      }
      return ok('AUTHORIZED');
    }
    case 'A3':
      return ok('AUTHORIZED');
  }
}
