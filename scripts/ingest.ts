/**
 * Standards ingestion pipeline → Supabase (PostgreSQL + pgvector).
 *
 *   import → validate → normalise → deduplicate → map relationships → embed → index
 *
 * Usage (server-side env vars required, see .env.example):
 *   npm run ingest                       # ingest the bundled demo dataset
 *   npm run ingest -- --input data/my.json   # ingest a JSON file with the RawDatasetInput shape
 *   npm run ingest -- --input data/standards.csv --relationships data/rel.json
 *   npm run ingest -- --dry-run          # validate + normalise only, no database writes
 *
 * CSV columns (header row): id,number,title,category,sector,productTypes,scope,keywords,year,status
 * (list columns are `;`-separated).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Auto-load .env when run directly via tsx
try {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch {
  // ignore
}
import { normalizeDataset, standardEmbeddingText, type RawDatasetInput, type RawStandardRecord } from '../src/engine/repository/normalize';
import { LocalEmbeddingProvider } from '../src/engine/providers/localEmbedding';
import type { EmbeddingProvider } from '../src/engine/providers/types';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[++i]);
}
const dryRun = args.get('dry-run') === 'true';

function parseCsv(text: string): RawStandardRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    const row = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      category: row.category as RawStandardRecord['category'],
      sector: row.sector as RawStandardRecord['sector'],
      productTypes: row.productTypes ? row.productTypes.split(';').map((s) => s.trim()) : [],
      scope: row.scope,
      keywords: row.keywords ? row.keywords.split(';').map((s) => s.trim()) : [],
      year: row.year ? Number(row.year) : null,
      status: (row.status || undefined) as RawStandardRecord['status'],
      isDemo: row.isDemo === 'true',
    };
  });
}

async function loadInput(): Promise<RawDatasetInput> {
  const input = args.get('input');
  if (!input) {
    const { loadDemoDataset } = await import('../src/engine/repository/demoDataset');
    const ds = loadDemoDataset();
    // Re-wrap the already-normalised demo dataset as raw input so it flows through the same pipeline.
    return {
      meta: ds.meta,
      standards: ds.standards.map((s) => ({
        id: s.id,
        number: s.number,
        title: s.title,
        category: s.category,
        sector: s.sector,
        productTypes: s.productTypes,
        scope: s.scope,
        keywords: s.keywords,
        year: s.latestVersion.year,
        editionLabel: s.latestVersion.label,
        history: s.versions.filter((v) => v.status === 'historical').map((v) => ({ label: v.label, year: v.year })),
        amendments: s.amendments,
        status: s.revisionStatus,
        source: s.source,
        isDemo: s.isDemo,
      })),
      relationships: ds.relationships,
      certifications: ds.certifications,
      standardCertifications: ds.standardCertifications,
    };
  }
  const path = resolve(process.cwd(), input);
  if (path.endsWith('.csv')) {
    const standards = parseCsv(readFileSync(path, 'utf8'));
    const rel = args.get('relationships');
    const extra = rel ? (JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as Partial<RawDatasetInput>) : {};
    return { standards, relationships: extra.relationships ?? [], certifications: extra.certifications ?? [], standardCertifications: extra.standardCertifications ?? [], meta: extra.meta };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as RawDatasetInput;
}

async function pickEmbeddings(): Promise<EmbeddingProvider> {
  const provider = (process.env.EMBEDDING_PROVIDER ?? 'local').toLowerCase();
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const { OpenAIEmbeddingProvider } = await import('../src/engine/providers/openai');
    return new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small');
  }
  if (provider === 'voyage' && process.env.VOYAGE_API_KEY) {
    const { VoyageEmbeddingProvider } = await import('../src/engine/providers/openai');
    return new VoyageEmbeddingProvider(process.env.VOYAGE_API_KEY, process.env.VOYAGE_EMBEDDING_MODEL || 'voyage-3-lite');
  }
  return new LocalEmbeddingProvider();
}

async function main() {
  const raw = await loadInput();
  const { dataset, report } = normalizeDataset(raw);
  console.log(`Normalised ${report.standards} standards, ${report.relationships} relationships.`);
  if (report.duplicateStandards.length) console.log(`  Deduplicated ids: ${report.duplicateStandards.join(', ')}`);
  if (report.droppedRelationships.length) console.log(`  Dropped ${report.droppedRelationships.length} dangling relationship(s).`);
  if (report.droppedCertifications.length) console.log(`  Dropped ${report.droppedCertifications.length} dangling certification mapping(s).`);

  const embeddings = await pickEmbeddings();
  console.log(`Embedding provider: ${embeddings.name}:${embeddings.model} (${embeddings.dimensions} dims)`);
  if (embeddings.dimensions !== 1536) {
    console.warn(`  WARNING: supabase/migrations declare vector(1536). Alter the column dimension to ${embeddings.dimensions} before indexing with this provider.`);
  }

  if (dryRun) {
    console.log('Dry run — no database writes.');
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required (or pass --dry-run).');
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const fail = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };

  // 1. Standards
  fail(
    'standards',
    (
      await supa.from('standards').upsert(
        dataset.standards.map((s) => ({
          id: s.id,
          number: s.number,
          title: s.title,
          category: s.category,
          sector: s.sector,
          product_types: s.productTypes,
          scope: s.scope,
          keywords: s.keywords,
          revision_status: s.revisionStatus,
          is_demo: s.isDemo,
          source_name: s.source.name,
          source_type: s.source.type,
          source_url: s.source.url ?? null,
          source_note: s.source.note ?? null,
          indexed_at: s.source.indexedAt,
        })),
      )
    ).error,
  );

  // 2. Versions + amendments
  const versions = dataset.standards.flatMap((s) => s.versions.map((v) => ({ standard_id: s.id, label: v.label, year: v.year, status: v.status, note: v.note ?? null, is_latest: v.label === s.latestVersion.label })));
  fail('standard_versions', (await supa.from('standard_versions').upsert(versions, { onConflict: 'standard_id,label' })).error);
  const amendments = dataset.standards.flatMap((s) => s.amendments.map((a) => ({ standard_id: s.id, number: a.number, year: a.year, summary: a.summary, is_placeholder: a.isPlaceholder })));
  if (amendments.length) fail('standard_amendments', (await supa.from('standard_amendments').upsert(amendments, { onConflict: 'standard_id,number' })).error);

  // 3. Relationships + certifications
  fail('standard_relationships', (await supa.from('standard_relationships').upsert(dataset.relationships.map((r) => ({ from_id: r.from, to_id: r.to, type: r.type, note: r.note ?? null })), { onConflict: 'from_id,to_id,type' })).error);
  fail('certifications', (await supa.from('certifications').upsert(dataset.certifications.map((c) => ({ id: c.id, scheme: c.scheme, name: c.name, authority: c.authority, description: c.description, url: c.url ?? null })))).error);
  fail(
    'standard_certifications',
    (await supa.from('standard_certifications').upsert(dataset.standardCertifications.map((c) => ({ standard_id: c.standardId, certification_id: c.certificationId, applicability: c.applicability, evidence: c.evidence, status: c.status, source_name: c.source.name })), { onConflict: 'standard_id,certification_id' })).error,
  );

  // 4. Embeddings (batched)
  const BATCH = 32;
  for (let i = 0; i < dataset.standards.length; i += BATCH) {
    const slice = dataset.standards.slice(i, i + BATCH);
    const texts = slice.map(standardEmbeddingText);
    const vectors = (await embeddings.embed(texts)).map((v) =>
      v.length === 1536 ? v : v.length < 1536 ? v.concat(new Array(1536 - v.length).fill(0)) : v.slice(0, 1536),
    );
    fail(
      'standard_embeddings',
      (
        await supa.from('standard_embeddings').upsert(
          slice.map((s, j) => ({ standard_id: s.id, chunk_index: 0, content: texts[j], embedding: vectors[j], provider: embeddings.name, model: embeddings.model })),
          { onConflict: 'standard_id,chunk_index,provider,model' },
        )
      ).error,
    );
    console.log(`  Indexed embeddings ${Math.min(i + BATCH, dataset.standards.length)}/${dataset.standards.length}`);
    if (i + BATCH < dataset.standards.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.log('Ingestion complete.');
}

main().catch((e) => {
  console.error('Ingestion failed:', (e as Error).message);
  process.exit(1);
});
