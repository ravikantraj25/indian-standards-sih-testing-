import process from 'node:process';
import { z } from 'zod';
import { HttpError, Router, json, parseBody } from './http';
import { getServerContext } from './config';
import { analyze } from '../src/engine/pipeline';
import { generateSpecification } from '../src/engine/generation/spec';
import { answerQuestion } from '../src/engine/chat/answer';
import { expandRelationships, buildKnowledgeGraph } from '../src/engine/graph/expand';
import { findCertifications } from '../src/engine/analysis/certifications';
import { getAnalysis, listHistory, persistAnalysis, toHistoryEntry } from './persistence';
import type { AnalysisResult, ChatMessage } from '../src/engine/types';

const MAX_TEXT = 200_000;

const analyzeSchema = z.object({
  text: z.string().trim().min(3, 'Please describe the product or paste a specification (at least 3 characters).').max(MAX_TEXT, 'Input is too long.'),
  source: z.enum(['text', 'paste', 'pdf']).optional(),
  fileName: z.string().max(200).optional(),
  topK: z.number().int().min(3).max(30).optional(),
});

const specSchema = z.object({ analysis: z.custom<AnalysisResult>((v) => typeof v === 'object' && v !== null && 'recommendations' in (v as object), 'analysis object required') });

const chatSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  analysis: z.custom<AnalysisResult | null>((v) => v === null || v === undefined || (typeof v === 'object' && 'recommendations' in (v as object))).optional(),
  history: z.array(z.custom<ChatMessage>()).max(20).optional(),
});

const standardsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(40).optional(),
  sector: z.string().max(40).optional(),
  productType: z.string().max(80).optional(),
  revisionStatus: z.string().max(40).optional(),
  certification: z.string().max(40).optional(),
  sort: z.enum(['number', 'title', 'year']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** Strips secrets: only mode/provider names are exposed. */
export function buildRouter(): Router {
  const router = new Router();

  router.add('GET', '/status', async () => {
    const ctx = await getServerContext();
    const info = await ctx.repo.datasetInfo();
    return json({
      ok: true,
      mode: ctx.mode,
      llm: ctx.ai.llm.name,
      embeddings: `${ctx.ai.embeddings.name}:${ctx.ai.embeddings.model}`,
      repository: ctx.repo.name,
      dataset: info,
      warnings: ctx.warnings,
      maxUploadMb: ctx.maxUploadMb,
      persistence: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
    });
  });

  router.add('POST', '/analyze', async (req) => {
    const body = parseBody(analyzeSchema, req.body);
    const ctx = await getServerContext();
    const result = await analyze({ text: body.text, source: body.source, fileName: body.fileName, topK: body.topK }, { repo: ctx.repo, ai: ctx.ai });
    void persistAnalysis(result);
    return json(result);
  });

  router.add('GET', '/standards', async (req) => {
    const q = parseBody(standardsQuerySchema, req.query);
    const ctx = await getServerContext();
    const result = await ctx.repo.listStandards({
      q: q.q,
      category: q.category as never,
      sector: q.sector as never,
      productType: q.productType,
      revisionStatus: q.revisionStatus,
      certification: q.certification,
      sort: q.sort,
      page: q.page,
      pageSize: q.pageSize,
    });
    return json(result);
  });

  router.add('GET', '/standards/facets', async () => {
    const ctx = await getServerContext();
    const all = await ctx.repo.allStandards();
    const count = (key: (s: (typeof all)[number]) => string) => {
      const m = new Map<string, number>();
      for (const s of all) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
      return [...m.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => a.value.localeCompare(b.value));
    };
    return json({
      categories: count((s) => s.category),
      sectors: count((s) => s.sector),
      revisionStatuses: count((s) => s.revisionStatus),
      certifications: (await ctx.repo.getCertifications()).map((c) => ({ value: c.id, label: c.name })),
      total: all.length,
    });
  });

  router.add('GET', '/standards/:id', async (_req, params) => {
    const ctx = await getServerContext();
    const standard = await ctx.repo.getStandard(params.id);
    if (!standard) throw new HttpError(404, 'Standard not found in the indexed dataset.', 'not-found');
    const { byStandard } = await expandRelationships([standard], ctx.repo);
    const relationships = byStandard.get(standard.id) ?? [];
    const certifications = await findCertifications([standard, ...relationships.map((r) => r.standard)], ctx.repo);
    const graph = buildKnowledgeGraph(standard.productTypes[0] ?? standard.title, [standard], byStandard, certifications);
    return json({ standard, relationships, certifications: certifications.filter((c) => c.standardId === standard.id), graph });
  });

  router.add('POST', '/spec', async (req) => {
    const body = parseBody(specSchema, req.body);
    const ctx = await getServerContext();
    return json(await generateSpecification(body.analysis, ctx.ai.llm));
  });

  router.add('POST', '/chat', async (req) => {
    const body = parseBody(chatSchema, req.body);
    const ctx = await getServerContext();
    return json(await answerQuestion({ question: body.question, analysis: body.analysis ?? null, history: body.history }, { repo: ctx.repo, ai: ctx.ai }));
  });

  router.add('GET', '/history', async () => {
    const entries = await listHistory();
    return json({ entries: entries ?? [], persisted: entries !== null });
  });

  router.add('GET', '/history/:id', async (_req, params) => {
    const a = await getAnalysis(params.id);
    if (!a) throw new HttpError(404, 'Analysis not found on the server (it may be stored locally in your browser).', 'not-found');
    return json({ analysis: a, entry: toHistoryEntry(a) });
  });

  return router;
}
