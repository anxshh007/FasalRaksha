/**
 * Every error is a domain explanation (Constitution §16). The API answers with a stable `code`
 * the interface renders in the farmer's language, and a plain-English `message` for operators.
 * Never "Something went wrong".
 */
import { ZodError } from 'zod';

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
  }
}

interface PgError {
  code?: string;
  message?: string;
}

const isPgError = (error: unknown): error is PgError =>
  typeof error === 'object' && error !== null && 'code' in error && typeof (error as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((error as PgError).code ?? '');

/** Translate database refusals into domain answers. The database's own sentence is kept. */
export function toDomainError(error: unknown): DomainError | null {
  if (error instanceof DomainError) return error;
  if (error instanceof ZodError) {
    const where = error.issues.map((i) => i.path.join('.') || '(body)').join(', ');
    return new DomainError(422, 'INVALID_REQUEST', `The request is missing something or has a value that is not allowed: ${where}.`);
  }
  if (!isPgError(error)) return null;
  const message = error.message ?? '';
  switch (error.code) {
    case '42501': // insufficient_privilege — RLS denial or a guard trigger
      return new DomainError(403, 'NOT_PERMITTED', message.startsWith('new row violates row-level security') ? 'You are not allowed to make this change.' : message);
    case '23505':
      return new DomainError(409, 'ALREADY_EXISTS', message.includes('duplicate key') ? 'This has already been recorded.' : message);
    case '40001':
      return new DomainError(409, 'CHANGED_ELSEWHERE', message);
    case '23514':
    case '23502':
    case '22P02':
      return new DomainError(422, 'NOT_VALID', message);
    case '54000':
      return new DomainError(429, 'LIMIT_REACHED', message);
    default:
      return null;
  }
}
