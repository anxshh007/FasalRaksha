/**
 * Messages between the camera screen and its worker (vision.worker.ts), and the client the screen
 * uses: one request in flight per id, answered by a promise, frames transferred (never copied).
 */
import type { CapturedView, GuidanceProblem, VisionFamily } from '@fasal/shared';

import type { GraderAbsence, PinnedFile } from './runtime';

export type { GraderAbsence } from './runtime';

export type WorkerRequest =
  | { type: 'configure'; family: VisionFamily | null; grading: boolean; runtime: PinnedFile; effectiveType: string | null }
  | { type: 'guide'; id: number; bitmap: ImageBitmap }
  | { type: 'view'; id: number; bitmap: ImageBitmap }
  | { type: 'encode'; id: number }
  | { type: 'discard' };

export type GraderStatus = { status: 'loading'; reason: null; version: null } | { status: 'ready'; reason: null; version: string } | { status: 'absent'; reason: GraderAbsence; version: null };

export type WorkerReply =
  | ({ type: 'grader' } & GraderStatus)
  | { type: 'guide'; id: number; problem: GuidanceProblem | null }
  | { type: 'view'; id: number; view: CapturedView; modelVersion: string | null }
  | { type: 'encoded'; id: number; blob: Blob; width: number; height: number }
  | { type: 'error'; id: number; kind: 'memory' | 'failed'; message: string };

export interface Encoded {
  blob: Blob;
  width: number;
  height: number;
}

export class WorkerFault extends Error {
  constructor(
    readonly kind: 'memory' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'WorkerFault';
  }
}

type Pending = { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void };

export class VisionClient {
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private graderListener: ((status: GraderStatus) => void) | null = null;

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<WorkerReply>) => this.receive(event.data);
    worker.onerror = () => {
      for (const p of this.pending.values()) p.reject(new WorkerFault('failed', 'the camera worker stopped'));
      this.pending.clear();
    };
  }

  static start(): VisionClient {
    return new VisionClient(new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module', name: 'vision' }));
  }

  onGrader(listener: (status: GraderStatus) => void): void {
    this.graderListener = listener;
  }

  configure(request: Omit<Extract<WorkerRequest, { type: 'configure' }>, 'type'>): void {
    this.worker.postMessage({ type: 'configure', ...request } satisfies WorkerRequest);
  }

  guide(bitmap: ImageBitmap): Promise<GuidanceProblem | null> {
    return this.ask({ type: 'guide', id: this.id(), bitmap }, [bitmap]).then((reply) => (reply.type === 'guide' ? reply.problem : null));
  }

  view(bitmap: ImageBitmap): Promise<{ id: number; view: CapturedView; modelVersion: string | null }> {
    const id = this.id();
    return this.ask({ type: 'view', id, bitmap }, [bitmap]).then((reply) => {
      if (reply.type !== 'view') throw new WorkerFault('failed', 'unexpected reply');
      return { id, view: reply.view, modelVersion: reply.modelVersion };
    });
  }

  encode(id: number): Promise<Encoded> {
    return this.ask({ type: 'encode', id }, []).then((reply) => {
      if (reply.type !== 'encoded') throw new WorkerFault('failed', 'unexpected reply');
      return { blob: reply.blob, width: reply.width, height: reply.height };
    });
  }

  discard(): void {
    this.worker.postMessage({ type: 'discard' } satisfies WorkerRequest);
  }

  terminate(): void {
    for (const p of this.pending.values()) p.reject(new WorkerFault('failed', 'closed'));
    this.pending.clear();
    this.worker.terminate();
  }

  private id(): number {
    return this.next++;
  }

  private ask(message: Extract<WorkerRequest, { id: number }>, transfer: Transferable[]): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  private receive(reply: WorkerReply): void {
    if (reply.type === 'grader') {
      this.graderListener?.(reply);
      return;
    }
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    this.pending.delete(reply.id);
    if (reply.type === 'error') pending.reject(new WorkerFault(reply.kind, reply.message));
    else pending.resolve(reply);
  }
}
