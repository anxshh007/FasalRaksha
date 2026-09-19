/**
 * SpeechAdapter (PROMPT §10.2). Offline, speech recognition cannot work and the product does not
 * pretend it does: the phone records the audio, the farmer finishes the listing with structured
 * fields immediately, and on reconnection the recording is transcribed here to enrich the record.
 *
 *   MockSpeechAdapter — transcribes only recordings it has been given a transcript for (matched by
 *                       SHA-256 of the audio); anything else comes back "unrecognised", which is
 *                       exactly what a real recogniser says about audio it cannot make out
 *   BhashiniSpeechAdapter — the Government of India's Bhashini (Dhruva) ASR inference pipeline
 */
import { createHash } from 'node:crypto';

import type { Locale } from '@fasal/shared';

import { AdapterError, fetchJson, type Transport } from '../http.js';

export interface TranscriptionRequest {
  audio: Uint8Array;
  mimeType: string;
  locale: Locale;
}

export interface Transcription {
  status: 'transcribed' | 'unrecognised';
  text: string | null;
  locale: Locale;
}

export interface SpeechAdapter {
  readonly mode: 'mock' | 'live';
  transcribe(request: TranscriptionRequest): Promise<Transcription>;
}

const ACCEPTED = ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
const MAX_BYTES = 5 * 1024 * 1024;

function checkRequest(adapter: string, request: TranscriptionRequest): void {
  if (!ACCEPTED.includes(request.mimeType.split(';')[0] ?? '')) throw new AdapterError(adapter, 'upstream-rejected', `Recordings in ${request.mimeType} cannot be transcribed.`);
  if (request.audio.byteLength === 0 || request.audio.byteLength > MAX_BYTES) throw new AdapterError(adapter, 'upstream-rejected', 'The recording is empty or longer than a spoken listing needs.');
}

export function audioHash(audio: Uint8Array): string {
  return createHash('sha256').update(audio).digest('hex');
}

export class MockSpeechAdapter implements SpeechAdapter {
  readonly mode = 'mock' as const;
  private readonly known = new Map<string, { locale: Locale; text: string }>();

  /** Register a recording and what was said in it (demo seed, tests). */
  remember(audio: Uint8Array, locale: Locale, text: string): void {
    this.known.set(audioHash(audio), { locale, text });
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcription> {
    checkRequest('MockSpeechAdapter', request);
    const hit = this.known.get(audioHash(request.audio));
    if (hit === undefined || hit.locale !== request.locale) return { status: 'unrecognised', text: null, locale: request.locale };
    return { status: 'transcribed', text: hit.text, locale: request.locale };
  }
}

export interface BhashiniConfig {
  /** Inference endpoint, e.g. https://dhruva-api.bhashini.gov.in/services/inference/pipeline */
  url: string;
  inferenceKey: string;
  /** ASR service id per language, from the Bhashini pipeline configuration call. */
  serviceIds: Partial<Record<Locale, string>>;
  transport?: Transport;
}

const AUDIO_FORMAT: Record<string, string> = { 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3' };

export class BhashiniSpeechAdapter implements SpeechAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: BhashiniConfig) {
    this.transport = config.transport ?? fetch;
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcription> {
    checkRequest('Bhashini ASR', request);
    const serviceId = this.config.serviceIds[request.locale];
    if (serviceId === undefined) throw new AdapterError('Bhashini ASR', 'not-configured', `No ${request.locale} speech service is configured.`);
    const body = (await fetchJson(this.transport, {
      adapter: 'Bhashini ASR',
      url: this.config.url,
      method: 'POST',
      headers: { authorization: this.config.inferenceKey },
      timeoutMs: 20_000,
      body: {
        pipelineTasks: [
          {
            taskType: 'asr',
            config: { language: { sourceLanguage: request.locale }, serviceId, audioFormat: AUDIO_FORMAT[request.mimeType.split(';')[0] ?? ''] ?? 'wav', samplingRate: 16000 },
          },
        ],
        inputData: { audio: [{ audioContent: Buffer.from(request.audio).toString('base64') }] },
      },
    })) as { pipelineResponse?: Array<{ taskType?: string; output?: Array<{ source?: unknown }> }> };
    const asr = body.pipelineResponse?.find((r) => r.taskType === 'asr');
    if (asr === undefined) throw new AdapterError('Bhashini ASR', 'bad-response', 'The speech service returned no transcription task.');
    const text = asr.output?.[0]?.source;
    return typeof text === 'string' && text.trim() !== ''
      ? { status: 'transcribed', text: text.trim(), locale: request.locale }
      : { status: 'unrecognised', text: null, locale: request.locale };
  }
}
