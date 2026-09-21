import type { IncomingMessage, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
import { ZodError, type ZodType } from 'zod';

/** Framework-agnostic request/response shapes shared by the Vite dev server and Vercel. */
export interface ApiRequest {
  method: string;
  path: string; // without the /api prefix, e.g. "/analyze"
  query: Record<string, string>;
  body: unknown;
  ip: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Handler = (req: ApiRequest, params: Record<string, string>) => Promise<ApiResponse>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'error',
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200): ApiResponse => ({ status, body });

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      throw new HttpError(400, `Invalid request: ${first?.path.join('.') || 'body'} — ${first?.message ?? 'validation failed'}`, 'validation');
    }
    throw e;
  }
}

// ───────────────────────────── Router ────────────────────────────────────────

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:(\w+)/g, (_, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
    return this;
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      if (!rateLimiter.allow(req.ip)) throw new HttpError(429, 'Too many requests — please slow down.', 'rate-limit');
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = req.path.match(r.pattern);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return await r.handler(req, params);
      }
      throw new HttpError(404, `No route for ${req.method} ${req.path}`, 'not-found');
    } catch (e) {
      return toErrorResponse(e);
    }
  }
}

/** Converts any thrown error into a safe, human-readable response (no stack traces). */
export function toErrorResponse(e: unknown): ApiResponse {
  if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
  const err = e as { name?: string; code?: string; message?: string };
  if (err?.name === 'AIProviderError') {
    const status = err.code === 'rate-limit' ? 429 : err.code === 'missing-key' ? 503 : 502;
    return json({ error: err.message ?? 'AI provider error', code: err.code }, status);
  }
  console.error('[api] unhandled error:', e);
  return json({ error: 'Something went wrong while processing the request. Please try again.', code: 'internal' }, 500);
}

// ───────────────────────────── Rate limiter ──────────────────────────────────

class RateLimiter {
  private buckets = new Map<string, { count: number; reset: number }>();
  constructor(private readonly perMinute: number) {}
  allow(ip: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(ip);
    if (!b || b.reset < now) {
      this.buckets.set(ip, { count: 1, reset: now + 60_000 });
      if (this.buckets.size > 5000) this.buckets.clear();
      return true;
    }
    b.count++;
    return b.count <= this.perMinute;
  }
}

export const rateLimiter = new RateLimiter(Number(process.env.RATE_LIMIT_PER_MINUTE) || 60);

// ───────────────────────────── Node adapter ──────────────────────────────────

const MAX_BODY_BYTES = 6 * 1024 * 1024; // extracted text payloads only; PDFs are parsed client-side

export async function readNodeRequest(req: IncomingMessage & { body?: unknown }, apiPrefix = '/api'): Promise<ApiRequest> {
  const matchedPath =
    (req.headers['x-matched-path'] as string) ||
    (req.headers['x-forwarded-uri'] as string) ||
    (req.headers['x-now-route-matches'] as string) ||
    req.url ||
    '/';
  const url = new URL(matchedPath, 'http://localhost');
  let pathname = url.pathname;
  if (pathname.endsWith('/index.ts') || pathname.endsWith('/index.js')) {
    pathname = (url.searchParams.get('path') || pathname).replace(/\/index\.(ts|js)$/, '');
  }
  const path = pathname.startsWith(apiPrefix) ? pathname.slice(apiPrefix.length) || '/' : pathname;
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));

  let body: unknown = req.body;
  if (body === undefined && req.method && !['GET', 'HEAD'].includes(req.method)) {
    body = await new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(new HttpError(413, 'Request body too large', 'too-large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new HttpError(400, 'Request body must be valid JSON', 'bad-json'));
        }
      });
      req.on('error', reject);
    });
  } else if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON', 'bad-json');
    }
  }

  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  return { method: (req.method ?? 'GET').toUpperCase(), path, query, body, ip };
}

export function writeNodeResponse(res: ServerResponse, out: ApiResponse): void {
  res.statusCode = out.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
  res.end(JSON.stringify(out.body));
}
