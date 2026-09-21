import { useState } from 'react';
import type { ConfidenceBreakdown } from '@/engine/types';
import { BAND_LABELS, CONFIDENCE_WEIGHTS } from '@/engine/ranking/confidence';
import { Badge, cx } from '@/components/ui';
import {
  Award,
  BarChart3,
  CheckCircle2,
  PieChart,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

const BAND_STYLE = {
  'very-high': { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', ring: 'ring-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 dark:ring-emerald-800', tone: 'emerald' as const },
  high: { bar: 'bg-blue-600', text: 'text-blue-700 dark:text-blue-400', ring: 'ring-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:ring-blue-800', tone: 'navy' as const },
  medium: { bar: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-400', ring: 'ring-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:ring-amber-800', tone: 'amber' as const },
  low: { bar: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', ring: 'ring-slate-200 bg-slate-100 dark:bg-slate-800 dark:ring-slate-700', tone: 'slate' as const },
} as const;

interface FactorConfig {
  key: keyof typeof CONFIDENCE_WEIGHTS;
  label: string;
  shortLabel: string;
  color: string;
  gradient: string;
  description: string;
}

const FACTORS: FactorConfig[] = [
  {
    key: 'semantic',
    label: 'Semantic similarity',
    shortLabel: 'Semantic',
    color: '#0d9488', // teal-600
    gradient: 'from-teal-500 to-emerald-600',
    description: 'Vector embedding & AI LLM semantic similarity to indexed standard scope',
  },
  {
    key: 'metadata',
    label: 'Metadata relevance',
    shortLabel: 'Metadata',
    color: '#f59e0b', // amber-500
    gradient: 'from-amber-500 to-orange-500',
    description: 'Keyword, title, sector and standard classification overlap',
  },
  {
    key: 'category',
    label: 'Product category match',
    shortLabel: 'Category',
    color: '#4f46e5', // indigo-600
    gradient: 'from-indigo-500 to-blue-600',
    description: 'Alignment with standard product category and indexed sector',
  },
  {
    key: 'coverage',
    label: 'Requirement coverage',
    shortLabel: 'Coverage',
    color: '#06b6d4', // cyan-500
    gradient: 'from-cyan-500 to-teal-500',
    description: 'Share of extracted tender parameters addressed by the standard',
  },
  {
    key: 'relationship',
    label: 'Relationship relevance',
    shortLabel: 'Relations',
    color: '#8b5cf6', // purple-500
    gradient: 'from-purple-500 to-indigo-600',
    description: 'Graph connectivity with allied, normative and testing standards',
  },
  {
    key: 'evidence',
    label: 'Evidence strength',
    shortLabel: 'Evidence',
    color: '#334155', // slate-700
    gradient: 'from-slate-600 to-slate-800',
    description: 'Direct evidence citations and clause references found',
  },
];

export function ConfidencePill({ c, compact }: { c: ConfidenceBreakdown; compact?: boolean }) {
  const s = BAND_STYLE[c.band];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        s.ring,
        s.text,
      )}
      title="AI Recommendation Confidence — not an official BIS score"
    >
      <span className={cx('size-1.5 rounded-full', s.bar)} />
      {compact ? c.total : `${BAND_LABELS[c.band]} · ${c.total}`}
    </span>
  );
}

type ViewTab = 'bars' | 'donut' | 'table';

export function ConfidenceMeter({ c, showBreakdown = false }: { c: ConfidenceBreakdown; showBreakdown?: boolean }) {
  const s = BAND_STYLE[c.band];
  const [activeTab, setActiveTab] = useState<ViewTab>('bars');
  const [hoveredFactor, setHoveredFactor] = useState<keyof typeof CONFIDENCE_WEIGHTS | null>(null);

  // Compute computed metrics for each factor
  const factorMetrics = FACTORS.map((f) => {
    const raw = c[f.key];
    const pct = Math.round(raw * 100);
    const weight = CONFIDENCE_WEIGHTS[f.key];
    const pts = Math.round(raw * weight * 100 * 10) / 10;
    return {
      ...f,
      raw,
      pct,
      weight,
      pts,
    };
  });

  const topFactor = [...factorMetrics].sort((a, b) => b.pts - a.pts)[0];

  // Donut chart geometry (R=58, C=2*pi*58 = 364.4)
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const donutSlices = factorMetrics.map((factor, idx) => {
    const sliceLength = (factor.pts / 100) * circumference;
    const strokeDasharray = `${Math.max(sliceLength, 0)} ${circumference}`;
    const offset = factorMetrics
      .slice(0, idx)
      .reduce((sum, f) => sum + (f.pts / 100) * circumference, 0);
    return {
      factor,
      strokeDasharray,
      strokeDashoffset: -offset,
    };
  });

  return (
    <div className="space-y-4">
      {/* Top summary strip (always keeps the text for screen queries and tests) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="label-caps font-bold tracking-wider text-ink-muted">AI Recommendation Confidence</span>
          <span className="text-[11px] text-ink-subtle">· 6-Factor Model</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={s.tone} className="font-semibold">
            {BAND_LABELS[c.band]} Confidence · {c.total}/100
          </Badge>
        </div>
      </div>

      {/* Progress bar fallback/compact view */}
      {!showBreakdown ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="meter"
          aria-valuenow={c.total}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cx('h-full rounded-full transition-[width] duration-700', s.bar)}
            style={{ width: `${c.total}%` }}
          />
        </div>
      ) : (
        /* Full Dashboard Graph UI (Inspired by user references) */
        <div className="rounded-2xl border border-line bg-surface-raised p-5 shadow-xs transition-all">
          {/* Card Header with View Switcher Tabs */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent" />
                <h4 className="text-[15px] font-bold text-ink tracking-tight">Confidence Intelligence Graph</h4>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Transparent multi-dimensional breakdown of standard applicability
              </p>
            </div>

            {/* Segmented View Switcher Tabs */}
            <div className="inline-flex rounded-xl bg-muted/80 p-1 border border-line/60 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setActiveTab('bars')}
                className={cx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all cursor-pointer',
                  activeTab === 'bars'
                    ? 'bg-surface-raised text-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                <BarChart3 className="size-3.5" />
                <span>Column Graph</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('donut')}
                className={cx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all cursor-pointer',
                  activeTab === 'donut'
                    ? 'bg-surface-raised text-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                <PieChart className="size-3.5" />
                <span>Distribution</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('table')}
                className={cx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all cursor-pointer',
                  activeTab === 'table'
                    ? 'bg-surface-raised text-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                <SlidersHorizontal className="size-3.5" />
                <span>Details</span>
              </button>
            </div>
          </div>

          {/* Graph Grid: Left Chart + Right Key Metrics Cards */}
          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Chart Area */}
            <div className="lg:col-span-8 flex flex-col justify-between">
              {activeTab === 'bars' && (
                <div className="space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between text-[11.5px] text-ink-muted">
                    <span className="font-semibold text-ink">Factor Alignment (% Match)</span>
                    <span className="text-[11px] text-ink-subtle">Hover a pillar to inspect details</span>
                  </div>

                  {/* High-Fidelity Column Bar Chart */}
                  <div className="relative pt-2 pb-1">
                    {/* Y-Axis Gridlines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-9 pl-8 pr-2">
                      <div className="flex items-center w-full">
                        <span className="text-[10px] text-ink-subtle w-8 font-mono">100%</span>
                        <div className="flex-1 border-b border-dashed border-line/60" />
                      </div>
                      <div className="flex items-center w-full">
                        <span className="text-[10px] text-ink-subtle w-8 font-mono">75%</span>
                        <div className="flex-1 border-b border-dashed border-line/60" />
                      </div>
                      <div className="flex items-center w-full">
                        <span className="text-[10px] text-ink-subtle w-8 font-mono">50%</span>
                        <div className="flex-1 border-b border-dashed border-line/60" />
                      </div>
                      <div className="flex items-center w-full">
                        <span className="text-[10px] text-ink-subtle w-8 font-mono">25%</span>
                        <div className="flex-1 border-b border-dashed border-line/60" />
                      </div>
                      <div className="flex items-center w-full">
                        <span className="text-[10px] text-ink-subtle w-8 font-mono">0%</span>
                        <div className="flex-1 border-b border-line" />
                      </div>
                    </div>

                    {/* Columns */}
                    <div className="relative pl-9 pr-2 grid grid-cols-6 gap-2 sm:gap-4 h-56 items-end pb-9">
                      {factorMetrics.map((factor) => {
                        const isHovered = hoveredFactor === factor.key;
                        return (
                          <div
                            key={factor.key}
                            onMouseEnter={() => setHoveredFactor(factor.key)}
                            onMouseLeave={() => setHoveredFactor(null)}
                            className="group flex flex-col items-center h-full justify-end relative cursor-pointer"
                          >
                            {/* Floating pill score on hover or prominent */}
                            <div
                              className={cx(
                                'absolute -top-7 transition-all duration-200 z-10 px-1.5 py-0.5 rounded text-[10.5px] font-bold shadow-xs whitespace-nowrap',
                                isHovered
                                  ? 'bg-ink text-ink-inverse scale-105'
                                  : 'bg-surface text-ink-muted border border-line',
                              )}
                            >
                              {factor.pct}%
                            </div>

                            {/* Bar Pillar Container */}
                            <div className="w-full max-w-[42px] h-[160px] rounded-xl bg-muted/60 dark:bg-slate-800/80 p-1 flex flex-col justify-end transition-transform group-hover:scale-102">
                              {/* Filled Bar Pillar with Gradient */}
                              <div
                                className={cx(
                                  'w-full rounded-lg bg-gradient-to-t shadow-xs transition-all duration-700 flex items-start justify-center pt-1.5',
                                  factor.gradient,
                                  isHovered && 'ring-2 ring-ink/30 ring-offset-1',
                                )}
                                style={{ height: `${Math.max(factor.pct, 6)}%` }}
                              />
                            </div>

                            {/* X-Axis Label */}
                            <div className="absolute -bottom-8 w-full text-center">
                              <span className="block truncate text-[11px] font-medium text-ink-muted group-hover:text-ink group-hover:font-semibold transition-colors">
                                {factor.shortLabel}
                              </span>
                              <span className="block text-[9.5px] font-mono text-ink-subtle">
                                ×{factor.weight}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'donut' && (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center animate-fade-in py-2">
                  {/* Donut Graphic */}
                  <div className="sm:col-span-6 flex justify-center items-center relative">
                    <svg className="size-44 -rotate-90 transform" viewBox="0 0 160 160">
                      {/* Background track */}
                      <circle
                        cx="80"
                        cy="80"
                        r={radius}
                        fill="transparent"
                        stroke="currentColor"
                        className="text-muted/60"
                        strokeWidth="18"
                      />
                      {/* Colored Segment Slices */}
                      {donutSlices.map(({ factor, strokeDasharray, strokeDashoffset }) => (
                        <circle
                          key={factor.key}
                          cx="80"
                          cy="80"
                          r={radius}
                          fill="transparent"
                          stroke={factor.color}
                          strokeWidth="18"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          className="transition-all duration-700 hover:opacity-85"
                        />
                      ))}
                    </svg>

                    {/* Donut Center Label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                      <span className="text-[28px] font-black leading-none text-ink">{c.total}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mt-0.5">
                        Total Score
                      </span>
                      <span className="text-[9.5px] font-medium text-ink-subtle">out of 100</span>
                    </div>
                  </div>

                  {/* Donut Legend */}
                  <div className="sm:col-span-6 space-y-2">
                    {factorMetrics.map((factor) => (
                      <div
                        key={factor.key}
                        className="flex items-center justify-between text-[12px] p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: factor.color }}
                          />
                          <span className="truncate text-ink-muted">{factor.label}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 font-mono">
                          <span className="font-semibold text-ink">+{factor.pts.toFixed(1)} pts</span>
                          <span className="text-[11px] text-ink-subtle">({factor.pct}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'table' && (
                <div className="space-y-2.5 animate-fade-in py-1">
                  {factorMetrics.map((factor) => (
                    <div
                      key={factor.key}
                      className="p-2.5 rounded-xl border border-line/60 bg-surface/50 hover:bg-surface transition-colors"
                    >
                      <div className="flex items-center justify-between text-[12.5px] font-semibold text-ink mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: factor.color }}
                          />
                          <span>{factor.label}</span>
                          <span className="text-[10.5px] font-mono font-normal text-ink-muted bg-muted px-1.5 py-0.5 rounded">
                            Weight ×{factor.weight}
                          </span>
                        </div>
                        <div className="font-mono">
                          <span className="text-ink">{factor.pct}%</span>
                          <span className="text-[11px] text-ink-muted ml-1.5">
                            → <strong className="text-primary">+{factor.pts.toFixed(1)} pts</strong>
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
                        <div
                          className={cx('h-full rounded-full bg-gradient-to-r', factor.gradient)}
                          style={{ width: `${factor.pct}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-ink-subtle leading-tight">{factor.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Key Metrics Cards (Styled like Image 2) */}
            <div className="lg:col-span-4 flex flex-col gap-3 justify-between border-t lg:border-t-0 lg:border-l border-line pt-4 lg:pt-0 lg:pl-6">
              {/* Card 1: Total Overall Score */}
              <div className="rounded-xl border border-line bg-surface p-4 shadow-2xs transition-all hover:border-line-strong">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-ink-muted">Overall Confidence</span>
                  <div className="grid size-7 place-items-center rounded-lg bg-soft text-soft-fg">
                    <Sparkles className="size-3.5" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-[28px] font-extrabold tracking-tight text-ink">{c.total}</span>
                  <span className="text-[13px] font-medium text-ink-muted">/ 100</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold">
                  <span className="text-tone-emerald-fg flex items-center gap-0.5">
                    ↑ {BAND_LABELS[c.band]} Band
                  </span>
                  <span className="text-ink-subtle font-normal">· Composite Index</span>
                </div>
              </div>

              {/* Card 2: Top Contributing Factor */}
              <div className="rounded-xl border border-line bg-surface p-4 shadow-2xs transition-all hover:border-line-strong">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-ink-muted">Top Contributing Factor</span>
                  <div className="grid size-7 place-items-center rounded-lg bg-soft text-soft-fg">
                    <Award className="size-3.5" />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="truncate text-[15px] font-bold text-ink">{topFactor.label}</div>
                  <div className="text-[12px] font-mono text-ink-muted mt-0.5">
                    Match: <strong className="text-ink">{topFactor.pct}%</strong> (weight ×{topFactor.weight})
                  </div>
                </div>
                <div className="mt-2 text-[11.5px] text-tone-emerald-fg font-medium">
                  +{topFactor.pts.toFixed(1)} points added to score
                </div>
              </div>

              {/* Card 3: Focus Metric Info */}
              <div className="rounded-xl border border-line bg-surface p-4 shadow-2xs transition-all hover:border-line-strong">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-ink-muted">Audit & Integrity</span>
                  <div className="grid size-7 place-items-center rounded-lg bg-soft text-soft-fg">
                    <ShieldCheck className="size-3.5" />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-[14px] font-bold text-ink flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Deterministic AI</span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-subtle leading-tight">
                    Every point is verifiable against the indexed standard requirements and evidence.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

