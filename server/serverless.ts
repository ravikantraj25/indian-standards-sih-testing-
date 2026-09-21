import type { IncomingMessage, ServerResponse } from 'node:http';
import { readNodeRequest, writeNodeResponse } from './http';
import { buildRouter } from './routes';

const router = buildRouter();

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  try {
    const apiReq = await readNodeRequest(req);
    const apiRes = await router.handle(apiReq);
    writeNodeResponse(res, apiRes);
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    console.error('[serverless-error]', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'Serverless Function Error',
        message: e?.message ?? String(err),
        stack: e?.stack,
        url: req.url,
      }),
    );
  }
}
