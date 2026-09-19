/**
 * Getting a camera, and saying precisely why not (PROMPT §7.7, CAM-01 … CAM-06).
 *
 *   unsupported  no camera API here (a page not served over HTTPS, an old browser): the file
 *                input instead, with the identical pipeline downstream (CAM-01)
 *   no-camera    the phone has no camera the browser can use (CAM-01)
 *   denied       the farmer, or a setting, said no. Explain why the camera was wanted, offer the
 *                file input, and never ask again in a loop (CAM-02)
 *   dismissed    the question was closed without an answer, which is not a "no": different
 *                words and one retry (CAM-03)
 *   busy         another app has the camera: name it, offer a retry (CAM-04)
 *   constraints  no rung of the ladder could be satisfied: the file input (CAM-05)
 *
 * The ladder (CAM-05): the rear camera at 1920 wide, then the rear camera at any size, then any
 * camera, then the file input.
 */

export const CONSTRAINT_LADDER: readonly MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: 'environment', width: 1920 } },
  { audio: false, video: { facingMode: 'environment' } },
  { audio: false, video: true },
];

export type CameraFailure = 'unsupported' | 'no-camera' | 'denied' | 'dismissed' | 'busy' | 'constraints';

export type CameraResult = { ok: true; stream: MediaStream; rung: number } | { ok: false; failure: CameraFailure };

export interface CameraEnv {
  /** The page may use the camera at all (HTTPS or localhost). */
  cameraContext: boolean;
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  permissions: Pick<Permissions, 'query'> | undefined;
}

export function browserCameraEnv(): CameraEnv {
  return { cameraContext: window.isSecureContext, mediaDevices: navigator.mediaDevices as MediaDevices | undefined, permissions: navigator.permissions as Permissions | undefined };
}

const CONSTRAINT_ERRORS = new Set(['OverconstrainedError', 'ConstraintNotSatisfiedError', 'TypeError']);
const PERMISSION_ERRORS = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError']);
const MISSING_ERRORS = new Set(['NotFoundError', 'DevicesNotFoundError']);
const BUSY_ERRORS = new Set(['NotReadableError', 'TrackStartError', 'AbortError']);

async function deniedOrDismissed(error: Error, permissions: CameraEnv['permissions']): Promise<'denied' | 'dismissed'> {
  try {
    const status = await permissions?.query({ name: 'camera' as PermissionName });
    // Closing the question leaves the permission undecided; refusing it records "denied".
    if (status?.state === 'prompt') return 'dismissed';
    if (status?.state === 'denied') return 'denied';
  } catch {
    // Some browsers cannot be asked about the camera permission; fall back to the message.
  }
  return /dismiss/i.test(error.message) ? 'dismissed' : 'denied';
}

export async function openCamera(env: CameraEnv): Promise<CameraResult> {
  if (!env.cameraContext || env.mediaDevices === undefined || typeof env.mediaDevices.getUserMedia !== 'function') return { ok: false, failure: 'unsupported' };
  for (let rung = 0; rung < CONSTRAINT_LADDER.length; rung++) {
    try {
      return { ok: true, stream: await env.mediaDevices.getUserMedia(CONSTRAINT_LADDER[rung]), rung };
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error(String(raw));
      if (CONSTRAINT_ERRORS.has(error.name)) continue; // the next, looser rung
      if (PERMISSION_ERRORS.has(error.name)) return { ok: false, failure: await deniedOrDismissed(error, env.permissions) };
      if (MISSING_ERRORS.has(error.name)) return { ok: false, failure: 'no-camera' };
      if (BUSY_ERRORS.has(error.name)) return { ok: false, failure: 'busy' };
      continue;
    }
  }
  return { ok: false, failure: 'constraints' };
}

/** Stop every track, so the camera light goes out; safe to call twice. */
export function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
