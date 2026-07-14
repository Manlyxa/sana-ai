import { err, ok, type Result } from '@sana/domain';
import type {
  DocumentToSign,
  PortError,
  SignatureArtifact,
  SignaturePort,
  SignatureRequest,
} from '@sana/ports';

/**
 * MockSignatureProvider (P4). Подписание — всегда асинхронный шаг с
 * человеком: запрос создаётся PENDING, «подписывает» владелец (в тестах —
 * signPending / declinePending). Приватный ключ здесь НЕ существует —
 * артефакт синтетический. Реальные реализации: NCALayer, eGov Mobile QR.
 */
export class MockSignatureProvider implements SignaturePort {
  private readonly requests = new Map<
    string,
    { request: SignatureRequest; document: DocumentToSign; artifact: SignatureArtifact | null }
  >();
  private readonly callbacks: Array<(artifact: SignatureArtifact) => void> = [];
  private seq = 0;

  async requestSignature(document: DocumentToSign): Promise<Result<SignatureRequest, PortError>> {
    this.seq += 1;
    const request: SignatureRequest = {
      id: `sigreq-${this.seq}`,
      documentId: document.id,
      status: 'PENDING',
    };
    this.requests.set(request.id, { request, document, artifact: null });
    return ok(request);
  }

  async getRequest(
    requestId: string,
  ): Promise<Result<{ request: SignatureRequest; artifact: SignatureArtifact | null }, PortError>> {
    const entry = this.requests.get(requestId);
    if (entry === undefined) {
      return err({ kind: 'NOT_FOUND', message: `заявка на подпись ${requestId} не найдена` });
    }
    return ok({ request: entry.request, artifact: entry.artifact });
  }

  onSigned(callback: (artifact: SignatureArtifact) => void): void {
    this.callbacks.push(callback);
  }

  /** Тестовый хелпер: владелец «подписал» заявку. */
  signPending(requestId: string, signedAtIso = '2026-05-10T12:00:00+05:00'): SignatureArtifact {
    const entry = this.requests.get(requestId);
    if (entry === undefined || entry.request.status !== 'PENDING') {
      throw new Error(`нет PENDING-заявки ${requestId}`);
    }
    const artifact: SignatureArtifact = {
      requestId,
      documentId: entry.document.id,
      cmsBase64: Buffer.from(`MOCK-CMS:${entry.document.contentHash}`).toString('base64'),
      signedAtIso,
    };
    entry.request = { ...entry.request, status: 'SIGNED' };
    entry.artifact = artifact;
    for (const cb of this.callbacks) cb(artifact);
    return artifact;
  }

  /** Тестовый хелпер: владелец отклонил подпись. */
  declinePending(requestId: string): void {
    const entry = this.requests.get(requestId);
    if (entry === undefined || entry.request.status !== 'PENDING') {
      throw new Error(`нет PENDING-заявки ${requestId}`);
    }
    entry.request = { ...entry.request, status: 'DECLINED' };
  }
}
