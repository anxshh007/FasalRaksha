/**
 * The API logger: pino, with personal data removed at three independent points (ARCH-02).
 *
 *  - `formatters.log` censors sensitive keys and scrubs strings in the merge object, at any
 *    depth, before pino serialises it;
 *  - the request/response serializers emit only method, path and status — never headers,
 *    query strings or client addresses;
 *  - the destination scrubs the final serialised line, which is the only place that sees the
 *    message, the child bindings and serializer output together. It is the net under the
 *    other two.
 *
 * What *is* logged, deliberately: request ids, routes, status codes, sync events, bundle
 * versions, decision inputs and outputs, security violations (PROMPT §8.5).
 */
import { destination, pino, stdSerializers, type DestinationStream, type Logger } from 'pino';

import type { LogLevel } from '../config.js';
import { REDACTED, scrubPii, scrubString } from './redact.js';

export type { Logger };

interface RequestLike {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  routeOptions?: { url?: unknown };
}

interface ResponseLike {
  statusCode?: unknown;
}

function serializeRequest(req: RequestLike): Record<string, unknown> {
  const url = typeof req.url === 'string' ? req.url : '';
  // The query string is dropped entirely: it is where identifiers leak into access logs.
  const path = url.split('?')[0] ?? '';
  return { id: req.id, method: req.method, path: scrubString(path), route: req.routeOptions?.url };
}

function serializeResponse(res: ResponseLike): Record<string, unknown> {
  return { statusCode: res.statusCode };
}

export interface LoggerOptions {
  level: LogLevel;
  /** Where lines go. Defaults to stdout. Tests pass an in-memory sink. */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  const sink: DestinationStream = options.destination ?? destination(1);
  const scrubbingSink: DestinationStream = {
    write(line: string): void {
      sink.write(scrubString(line));
    },
  };

  return pino(
    {
      level: options.level,
      base: { service: 'fasal-api' },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
        censor: REDACTED,
      },
      formatters: {
        log: (object) => scrubPii(object) as Record<string, unknown>,
      },
      serializers: {
        req: serializeRequest,
        res: serializeResponse,
        err: stdSerializers.err,
      },
    },
    scrubbingSink,
  );
}
