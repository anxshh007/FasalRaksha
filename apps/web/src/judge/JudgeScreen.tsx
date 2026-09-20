/**
 * Judge Mode (PROMPT §14.4) — the only surface in this product that may use model terminology,
 * and the only one written to be disbelieved.
 *
 * It exists so that a judge can hold this screen next to the farmer's and check that the same
 * release, the same freshness, the same adapters and the same nine layers are behind both. Every
 * number here is read at the moment it is shown: the server half from artefacts on disk and rows
 * in the database (`/api/_judge/status`), the device half from this phone's own IndexedDB and the
 * same engines the briefing uses. Nothing is written by hand and nothing is cached for effect.
 *
 * It is lazy-loaded, reachable only by typing `#/_judge`, in English, and never linked from a
 * farmer screen — a farmer has no use for conformal coverage, and a product that shows them a
 * skill score is lying about what it knows.
 */
import { useEffect, useState } from 'react';

import { evidenceLedger } from '../briefing/evidence';
import { store } from '../offline/db';
import { request } from '../offline/http';
import type { Device } from '../state/useDevice';

interface JudgeStatus {
  service: { version: string; nodeEnv: string; now: string };
  release: { version: string | null; asOf: string | null; generatedAt: string | null; loadedAt: string | null; dataSource: string | null; ageDays: number | null; bundles: Array<{ crop: string; district: string; status: string; bytes: number }> };
  adapters: Record<string, string>;
  ingest: Record<string, unknown> | null;
  validation: Array<{ crop: string; district: string; horizon: string; status: string; skillNaive: number | null; skillSeasonal: number | null; directionalAccuracy: number | null; coverageConformal: number | null; reason: string | null }>;
  vision: { version: string | null; fieldValidated: boolean; note: string | null; families: Array<{ family: string; accuracy: number | null; withinOneGrade: number | null; int8AgreesWithFloat: number | null }> } | null;
  requirements: { total: number; byStatus: Record<string, number>; byFamily: Record<string, number>; tested: number };
}

interface DeviceFacts {
  bundles: Array<{ key: string; version: string; asOf: string; storedAt: number }>;
  shared: string[];
  demand: { district: string; asOf: string; buyers: number; requirements: number } | null;
  weather: { district: string; issuedDate: string; days: number; source: string } | null;
  outbox: Record<string, number>;
  deals: number;
  photos: number;
  events: Array<{ at: number; kind: string; subject: string; detail: string }>;
}

async function readDevice(): Promise<DeviceFacts> {
  const db = store();
  const [bundles, shared, demand, weather, outbox, deals, photos, events] = await Promise.all([
    db.bundles.toArray(),
    db.shared.toArray(),
    db.demand.toArray(),
    db.weather.toArray(),
    db.outbox.toArray(),
    db.deals.count(),
    db.photos.count(),
    db.events.orderBy('at').reverse().limit(12).toArray(),
  ]);
  const byState: Record<string, number> = {};
  for (const entry of outbox) byState[entry.state] = (byState[entry.state] ?? 0) + 1;
  const first = demand[0];
  const sky = weather[0];
  return {
    bundles: bundles.map((b) => ({ key: b.key, version: b.version, asOf: b.asOf, storedAt: b.storedAt })),
    shared: shared.map((s) => s.name),
    demand: first === undefined ? null : { district: first.district, asOf: first.asOf, buyers: first.demand.buyers.length, requirements: first.demand.requirements.length },
    weather: sky === undefined ? null : { district: sky.district, issuedDate: sky.issuedDate, days: sky.forecast.days.length, source: sky.forecast.source },
    outbox: byState,
    deals,
    photos,
    events: events.map((e) => ({ at: e.at, kind: e.kind, subject: e.subject, detail: e.detail })),
  };
}

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
const num = (value: number | null) => (value === null ? '—' : value.toFixed(3));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="judge__section">
      <h2 className="judge__heading">{title}</h2>
      {children}
    </section>
  );
}

export function JudgeScreen({ device }: { device: Device }) {
  const [status, setStatus] = useState<JudgeStatus | null>(null);
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const briefing = device.briefing;
  const lead = briefing?.crops.find((c) => c.crop === device.selectedCrop) ?? briefing?.crops[0] ?? null;

  useEffect(() => {
    void (async () => {
      const answer = await request<JudgeStatus>('/api/_judge/status');
      if (answer.kind === 'ok') setStatus(answer.body);
      else setError(answer.kind === 'unreachable' ? 'server unreachable — the device half below is still live' : `server said ${answer.kind}`);
      setFacts(await readDevice());
    })();
  }, []);

  return (
    <div className="judge" data-testid="judge">
      <h1 className="judge__title">Judge Mode</h1>
      <p className="judge__note">
        Internal diagnostics. Every figure is read from an artefact, a database row or this device at the moment it is displayed. This route is never linked from the
        farmer interface.
      </p>
      {error !== null && <p className="judge__error" data-testid="judge-error">{error}</p>}

      <Section title="Release and data freshness">
        <dl className="judge__grid" data-testid="judge-release">
          <div>
            <dt>Bundle release</dt>
            <dd>{status?.release.version ?? '—'}</dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>
              {status?.release.asOf ?? '—'} {status?.release.ageDays === null || status === null ? '' : `(${status.release.ageDays} d old)`}
            </dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd data-testid="judge-data-source">{status?.release.dataSource ?? '—'}</dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd>{status?.release.generatedAt ?? '—'}</dd>
          </div>
          <div>
            <dt>Loaded by this server</dt>
            <dd>{status?.release.loadedAt ?? '—'}</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>
              {status?.service.version ?? '—'} · {status?.service.nodeEnv ?? '—'}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Adapters — mock or live">
        <ul className="judge__list" data-testid="judge-adapters">
          {Object.entries(status?.adapters ?? {}).map(([name, mode]) => (
            <li key={name} data-adapter={name} data-mode={mode}>
              <span>{name}</span>
              <strong>{mode}</strong>
            </li>
          ))}
        </ul>
      </Section>

      {lead !== null && (
        <Section title={`RAKSHA layers — ${lead.crop}, ${briefing?.district ?? ''}`}>
          {/* All nine, from the same ledger the farmer's evidence panel is built from: six carried
              in the bundle, and RK-7, RK-8 and RK-9 computed here on the device. */}
          <div className="judge__scroll">
          <table className="judge__table" data-testid="judge-layers">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Computed</th>
                <th>Value</th>
                <th>Weight</th>
                <th>Reading</th>
              </tr>
            </thead>
            <tbody>
              {evidenceLedger(lead.bundle, lead.evaluation).map((row) => (
                <tr key={row.id} data-layer={row.id}>
                  <td>{row.id}</td>
                  <td>{row.kind === 'layer' ? 'server (bundle)' : 'device'}</td>
                  <td>
                    {row.kind === 'layer'
                      ? (row.value?.toFixed(3) ?? '—')
                      : row.kind === 'downside'
                        ? `${row.status}${row.lotLoss === null ? '' : ` · ₹${Math.round(row.lotLoss)} of ₹${Math.round(row.tolerable ?? 0)}`}`
                        : row.kind === 'agreement'
                          ? `${row.strength ?? '—'}${row.share === null ? '' : ` · ${row.share.toFixed(2)}`}`
                          : `${row.passed} passed${row.failed.length === 0 ? '' : ` · failed ${row.failed.join(', ')}`}`}
                  </td>
                  <td>{row.kind === 'layer' ? row.weight.toFixed(3) : '—'}</td>
                  <td>{row.kind === 'layer' ? `${row.direction ?? '—'} · ${row.stance}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="judge__scroll">
          <table className="judge__table" data-testid="judge-conditions">
            <thead>
              <tr>
                <th>Condition</th>
                <th>Status</th>
                <th>Measured</th>
                <th>Threshold</th>
              </tr>
            </thead>
            <tbody>
              {lead.evaluation.conditions.map((condition) => (
                <tr key={condition.id} data-condition={condition.id} data-status={condition.status}>
                  <td>{condition.id}</td>
                  <td>{condition.status}</td>
                  <td>{condition.measured === null ? '—' : condition.measured.toFixed(4)}</td>
                  <td>{condition.threshold === null ? '—' : String(condition.threshold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="judge__note">
            Verdict: <strong>{lead.evaluation.suppressed ? 'suppressed (stale)' : lead.evaluation.verdict}</strong> · horizon 7 d · weather urgency:{' '}
            {lead.urgency.level} ({lead.urgency.reason})
          </p>
        </Section>
      )}

      <Section title="Forecast validation — skill against baselines, out of fold">
        <div className="judge__scroll">
          <table className="judge__table" data-testid="judge-validation">
          <thead>
            <tr>
              <th>Crop × district</th>
              <th>Horizon</th>
              <th>Published</th>
              <th>Skill vs naive</th>
              <th>Skill vs seasonal</th>
              <th>Directional</th>
              <th>Conformal coverage</th>
            </tr>
          </thead>
          <tbody>
            {(status?.validation ?? []).map((row) => (
              <tr key={`${row.crop}-${row.district}-${row.horizon}`}>
                <td>
                  {row.crop} · {row.district}
                </td>
                <td>{row.horizon}</td>
                <td>{row.status}{row.reason === null ? '' : ` — ${row.reason}`}</td>
                <td>{num(row.skillNaive)}</td>
                <td>{num(row.skillSeasonal)}</td>
                <td>{pct(row.directionalAccuracy)}</td>
                <td>{pct(row.coverageConformal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
          </div>
      </Section>

      {status?.vision != null && (
        <Section title="Grading models — held-out synthetic lots">
          <p className="judge__note" data-testid="judge-vision-note">
            {status.vision.version} · field-validated: <strong>{String(status.vision.fieldValidated)}</strong> · {status.vision.note}
          </p>
          <div className="judge__scroll">
          <table className="judge__table" data-testid="judge-vision">
            <thead>
              <tr>
                <th>Family</th>
                <th>Exact grade</th>
                <th>Within one grade</th>
                <th>INT8 agrees with float</th>
              </tr>
            </thead>
            <tbody>
              {status.vision.families.map((family) => (
                <tr key={family.family}>
                  <td>{family.family}</td>
                  <td>{pct(family.accuracy)}</td>
                  <td>{pct(family.withinOneGrade)}</td>
                  <td>{pct(family.int8AgreesWithFloat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>
      )}

      <Section title="Ingest report — what the cleaner did to the raw feed">
        <pre className="judge__pre" data-testid="judge-ingest">
          {status?.ingest === null || status === undefined ? '—' : JSON.stringify(status?.ingest, null, 1)}
        </pre>
      </Section>

      <Section title="This device — offline cache">
        <dl className="judge__grid" data-testid="judge-device">
          <div>
            <dt>Bundles cached</dt>
            <dd>{facts?.bundles.length ?? 0}</dd>
          </div>
          <div>
            <dt>Shared documents</dt>
            <dd>{facts?.shared.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>Demand</dt>
            <dd>{facts?.demand === null || facts === null ? '—' : `${facts.demand.district} · ${facts.demand.buyers} buyers · ${facts.demand.requirements} requirements`}</dd>
          </div>
          <div>
            <dt>Weather</dt>
            <dd>{facts?.weather == null ? '—' : `${facts.weather.issuedDate} · ${facts.weather.days} days · ${facts.weather.source}`}</dd>
          </div>
          <div>
            <dt>Outbox</dt>
            <dd>{Object.entries(facts?.outbox ?? {}).map(([state, n]) => `${state}: ${n}`).join(' · ') || 'empty'}</dd>
          </div>
          <div>
            <dt>Deals / photos held</dt>
            <dd>
              {facts?.deals ?? 0} / {facts?.photos ?? 0}
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{device.reach?.reachable === true ? `reachable · last ${new Date(device.reach.checkedAt).toISOString().slice(11, 19)}` : 'unreachable (field mode)'}</dd>
          </div>
        </dl>
        <div className="judge__scroll">
          <table className="judge__table" data-testid="judge-events">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Subject</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {(facts?.events ?? []).map((event) => (
              <tr key={`${event.at}-${event.subject}`}>
                <td>{new Date(event.at).toISOString().slice(11, 19)}</td>
                <td>{event.kind}</td>
                <td>{event.subject}</td>
                <td>{event.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
          </div>
      </Section>

      <Section title="Requirements — Gate J">
        <dl className="judge__grid" data-testid="judge-requirements">
          <div>
            <dt>Rows</dt>
            <dd>{status?.requirements.total ?? '—'}</dd>
          </div>
          <div>
            <dt>With tests named</dt>
            <dd>{status?.requirements.tested ?? '—'}</dd>
          </div>
          {Object.entries(status?.requirements.byStatus ?? {}).map(([state, n]) => (
            <div key={state}>
              <dt>{state}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
