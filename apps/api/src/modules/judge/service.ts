/**
 * Judge Mode, server side (PROMPT §14.4).
 *
 * The one surface in this product that may use model terminology freely, and the one that exists
 * to be disbelieved: everything here is read from an artefact on disk or a row in the database at
 * the moment it is asked for, never written by hand. A judge should be able to hold this next to
 * the farmer's screen and check that the same release, the same freshness and the same adapters
 * are behind both.
 *
 *   release      which bundle release is loaded, when it was generated, what it was built from
 *   adapters     mock or live, one line each — a live adapter with a missing credential cannot
 *                even start the server (config.ts), so this is a report, not a claim
 *   ingest       the cleaner's own report: rows in, units repaired, rows rejected and why
 *   validation   skill against naive and seasonal baselines, directional accuracy, conformal
 *                coverage, per crop × district × horizon, and which of them was published
 *   vision       the grading pipeline's version and the models actually shipped
 *   requirements REQUIREMENTS.csv counted by family and status: Gate J's own evidence
 *
 * It answers without a session on purpose: a judge at a demonstration has no account, and nothing
 * here is anyone's personal data. It is never linked from a farmer screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Config } from '../../config.js';
import { withAnonymous, type Database } from '../../db/actor.js';

const ROOT = resolve(import.meta.dirname, '../../../../..');

function readJson<T>(...parts: string[]): T | null {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, ...parts), 'utf8')) as T;
  } catch {
    return null; // an artefact that is not there is reported as absent, never invented
  }
}

export interface JudgeAdapters {
  market: string;
  weather: string;
  registry: string;
  messaging: string;
  speech: string;
  modelFallback: string;
  storage: string;
  transport: string;
  /** Whether the narrow channels are open at all: a webhook with no shared secret is closed. */
  channels: 'configured' | 'closed';
}

export interface JudgeValidationRow {
  crop: string;
  district: string;
  horizon: 'h7' | 'h14';
  status: string;
  skillNaive: number | null;
  skillSeasonal: number | null;
  directionalAccuracy: number | null;
  waitPrecision: number | null;
  coverageConformal: number | null;
  reason: string | null;
}

export interface JudgeStatus {
  service: { version: string; nodeEnv: string; now: string };
  release: {
    version: string | null;
    asOf: string | null;
    generatedAt: string | null;
    /** When this server loaded it, which is not when the pipeline generated it. */
    loadedAt: string | null;
    dataSource: string | null;
    ageDays: number | null;
    bundles: Array<{ crop: string; district: string; status: string; bytes: number }>;
  };
  adapters: JudgeAdapters;
  ingest: Record<string, unknown> | null;
  validation: JudgeValidationRow[];
  /** The grading pipeline actually shipped, and what its held-out numbers were (never field accuracy). */
  vision: { version: string | null; fieldValidated: boolean; note: string | null; families: Array<{ family: string; accuracy: number | null; withinOneGrade: number | null; int8AgreesWithFloat: number | null }> } | null;
  requirements: { total: number; byStatus: Record<string, number>; byFamily: Record<string, number>; tested: number };
}

interface PipelineManifest {
  version: string;
  asOf: string;
  generatedAt: string;
  dataSource: string;
  cores: Array<{ crop: string; district: string; status: string; bytes: number }>;
}

interface ValidationEntry {
  crop: string;
  district: string;
  horizons: Record<string, { status: string; reason: string | null; skill_naive: number; skill_seasonal: number; directional_accuracy: number; wait_precision: number | null; coverage_conformal: number }>;
}

/** REQUIREMENTS.csv, counted. Gate J is "every P1 row done with a passing test", so it is counted here. */
function requirements(): JudgeStatus['requirements'] {
  const csv = (() => {
    try {
      return readFileSync(resolve(ROOT, 'REQUIREMENTS.csv'), 'utf8');
    } catch {
      return '';
    }
  })();
  const rows = csv.split(/\r?\n/).slice(1).filter((line) => line.trim().length > 0);
  const byStatus: Record<string, number> = {};
  const byFamily: Record<string, number> = {};
  let tested = 0;
  for (const line of rows) {
    // The last field is the status; the one before it is the semicolon-separated test list.
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')) ?? [];
    const status = (cells.at(-2) ?? '').trim() || (cells.at(-1) ?? '').trim();
    const tests = (cells.at(-3) ?? '').trim();
    const family = (cells[0] ?? '').split('-')[0] ?? '';
    if (family === '') continue;
    byFamily[family] = (byFamily[family] ?? 0) + 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (tests.length > 0) tested++;
  }
  return { total: rows.length, byStatus, byFamily, tested };
}

export async function judgeStatus(db: Database | undefined, config: Config, now: Date, apiVersion: string): Promise<JudgeStatus> {
  // The release actually loaded is the database's answer, not the newest folder on disk.
  const loaded =
    db === undefined
      ? null
      : await withAnonymous(db, async (client) => {
          const { rows } = await client.query<{ version: string; as_of: string; data_source: string; released_at: Date }>(
            'SELECT version, as_of::text, data_source, released_at FROM app.bundle_releases ORDER BY released_at DESC, version DESC LIMIT 1',
          );
          return rows[0] ?? null;
        }).catch(() => null);

  const version = loaded?.version ?? null;
  const pipeline = version === null ? null : readJson<PipelineManifest>('data', 'bundles', version, 'pipeline', 'manifest.json');
  const asOf = loaded?.as_of ?? pipeline?.asOf ?? null;
  const ageDays = asOf === null ? null : Math.floor((Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);

  const validationRaw = readJson<ValidationEntry[]>('data', 'clean', 'validation_report.json') ?? [];
  const validation: JudgeValidationRow[] = validationRaw.flatMap((entry) =>
    (['h7', 'h14'] as const).flatMap((horizon) => {
      const h = entry.horizons[horizon];
      if (h === undefined) return [];
      return [
        {
          crop: entry.crop,
          district: entry.district,
          horizon,
          status: h.status,
          skillNaive: h.skill_naive ?? null,
          skillSeasonal: h.skill_seasonal ?? null,
          directionalAccuracy: h.directional_accuracy ?? null,
          waitPrecision: h.wait_precision ?? null,
          coverageConformal: h.coverage_conformal ?? null,
          reason: h.reason,
        },
      ];
    }),
  );

  const vision = readJson<{
    version?: string;
    fieldValidated?: boolean;
    note?: string;
    families?: Array<{ family: string; accuracy?: number; withinOneGrade?: number; int8AgreesWithFloat?: number }>;
  }>('data', 'models', 'report.json');

  return {
    service: { version: apiVersion, nodeEnv: config.NODE_ENV, now: now.toISOString() },
    release: {
      version,
      asOf,
      generatedAt: pipeline?.generatedAt ?? null,
      loadedAt: loaded?.released_at?.toISOString() ?? null,
      dataSource: loaded?.data_source ?? pipeline?.dataSource ?? null,
      ageDays,
      bundles: (pipeline?.cores ?? []).map((core) => ({ crop: core.crop, district: core.district, status: core.status, bytes: core.bytes })),
    },
    adapters: {
      market: config.MARKET_ADAPTER,
      weather: config.WEATHER_ADAPTER,
      registry: config.REGISTRY_ADAPTER,
      messaging: config.MESSAGING_ADAPTER,
      speech: config.SPEECH_ADAPTER,
      modelFallback: config.MODEL_FALLBACK_ADAPTER,
      storage: config.STORAGE_ADAPTER,
      transport: config.TRANSPORT_ADAPTER,
      channels: config.CHANNEL_SECRET === undefined || config.CHANNEL_SECRET.length === 0 ? 'closed' : 'configured',
    },
    ingest: readJson<Record<string, unknown>>('data', 'clean', 'ingest_report.json'),
    validation,
    vision:
      vision === null
        ? null
        : {
            version: vision.version ?? null,
            // Held-out synthetic lots, never a field accuracy: the report says so and so does this.
            fieldValidated: vision.fieldValidated ?? false,
            note: vision.note ?? null,
            families: (vision.families ?? []).map((f) => ({
              family: f.family,
              accuracy: f.accuracy ?? null,
              withinOneGrade: f.withinOneGrade ?? null,
              int8AgreesWithFloat: f.int8AgreesWithFloat ?? null,
            })),
          },
    requirements: requirements(),
  };
}
