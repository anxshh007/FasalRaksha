/**
 * Upsert keys in the repository's `.env` (gitignored). Existing keys are replaced in place;
 * everything else in the file is preserved.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function upsertEnv(path: string, entries: Readonly<Record<string, string>>): void {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(entries));
  const out = lines.map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
    if (key !== undefined && pending.has(key)) {
      const value = pending.get(key) ?? '';
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  writeFileSync(path, `${out.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function loadEnvIfPresent(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
