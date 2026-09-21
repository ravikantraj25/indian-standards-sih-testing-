import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Router } from '../server/http';

let routerInstance: Router | null = null;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  try {
    const { readNodeRequest, writeNodeResponse } = await import('../server/http');
    const { buildRouter } = await import('../server/routes');
    if (!routerInstance) {
      routerInstance = buildRouter();
    }
    const apiReq = await readNodeRequest(req);
    const apiRes = await routerInstance.handle(apiReq);
    writeNodeResponse(res, apiRes);
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    console.error('[vercel-serverless-error]', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'Serverless Function Error',
        message: e?.message ?? String(err),
        stack: e?.stack,
        url: req.url,
        matchedPath: req.headers['x-matched-path'] || req.headers['x-forwarded-uri'],
      }),
    );
  }
}
