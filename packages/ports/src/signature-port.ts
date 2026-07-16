import type { Result } from '@sana/domain';
import type { PortError } from './common';

/**
 * Подпись ЭЦП (P4). Закон РК не допускает передачу ЭЦП третьим лицам:
 * система НИКОГДА не хранит и не принимает приватный ключ. Порт только
 * ЗАПРАШИВАЕТ подпись у владельца; подписание — всегда асинхронный шаг
 * с человеком (NCALayer / eGov Mobile QR / мобильная ЭЦП — позже).
 */

export type DocumentToSign = {
  readonly id: string;
  readonly title: string;
  /** SHA-256 содержимого — владелец видит, что подписывает. */
  readonly contentHash: string;
  /** Содержимое документа (base64). */
  readonly contentBase64: string;
};

export type SignatureRequestStatus = 'PENDING' | 'SIGNED' | 'DECLINED' | 'EXPIRED';

export type SignatureRequest = {
  readonly id: string;
  readonly documentId: string;
  readonly status: SignatureRequestStatus;
};

/** Результат подписания: КМА/CMS-подпись, произведённая на стороне владельца. */
export type SignatureArtifact = {
  readonly requestId: string;
  readonly documentId: string;
  readonly cmsBase64: string;
  readonly signedAtIso: string;
};

export interface SignaturePort {
  /** Запросить подпись. Возвращает PENDING-заявку; результат придёт колбэком. */
  requestSignature(document: DocumentToSign): Promise<Result<SignatureRequest, PortError>>;

  getRequest(
    requestId: string,
  ): Promise<Result<{ request: SignatureRequest; artifact: SignatureArtifact | null }, PortError>>;

  /** Подписка на завершение подписания (асинхронный колбэк). */
  onSigned(callback: (artifact: SignatureArtifact) => void): void;
}
