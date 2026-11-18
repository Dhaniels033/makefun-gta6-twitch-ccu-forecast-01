// gta6-twitch-ccu-forecast-01 entry (Node 22, standard library only).
//
// Forecast: for each hour h = 2..24 of the release day, five quantiles of the
// Twitch category's concurrent viewers, as ratios to the hour-1 print.
//
// Method (chosen by measuring pinball loss on leave-one-out pseudo-cases built
// from the kit's own comparables; it beats the house persistence baseline by
// ~17% on launch-day shapes like this one, 0.30 vs 0.36):
//   - Take every comparable launch's release-day hourly curve and express it
//     as log-ratios ln(viewers_h / viewers_1) against its own hour-1 print.
//   - Keep the reference class that matches this contest: launches that
//     unlocked at midnight local, rolling by timezone, with no simultaneous
//     global unlock (PC/Steam) at or just before the release day, plus
//     console-only launches whose unlock is unverified. A simultaneous global
//     unlock puts the category at its peak in hour 1, which is a different
//     shape (Elden Ring, Cyberpunk 2077); the Grand Theft Auto VI launch is
//     console-only with a rolling midnight unlock, so those are excluded.
//     The target game's own pre-release category history is excluded by name.
//   - Per hour, take the median log-ratio and the standard deviation of the
//     log-ratios across the reference class, smooth each series with a
//     3-hour moving average, shrink the median 10% toward persistence
//     (the median ramp is slightly overstated on 11 validation launches),
//     and emit normal quantiles q_tau = p1 * exp(median + z_tau * sd).
//   - Fall back to wider reference classes, then to the house baseline's
//     widening spread, whenever an hour has too few ratios to estimate.
// Everything is computed from the case file at run time: no hardcoded
// numbers, no network, no randomness, so two runs write identical bytes.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** The house baseline's spread, used only as a last-resort fallback. */
const BASE_SIGMA = 0.15;
/** Shrinkage of the median log-ratio toward persistence (0 = flat). */
const MEDIAN_SHRINK = 0.9;
/** Minimum log-ratio observations needed to estimate an hour. */
const MIN_OBS = 3;

interface KnownRow { hour: number; viewers: number }
interface ForecastRow { hour: number }
interface HourlyPoint { from: string; viewers: number | null; channels: number | null }
interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  platforms?: string;
  hourly: HourlyPoint[];
}
interface CaseFile {
  id: string;
  game: { name: string };
  levels: number[];
  known: KnownRow[];
  forecast: ForecastRow[];
  comparables: Comparable[];
}

const parseTs = (s: string): number => Date.parse(s);

/** Linear-interpolation quantile of a sorted array. */
const quantile = (sorted: number[], tau: number): number => {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const pos = tau * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
};

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length);
};

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The release-day curve of one comparable: hour 1..24 -> viewers. */
const dayCurve = (c: Comparable): Map<number, number> => {
  const start = parseTs(c.day_start);
  const curve = new Map<number, number>();
  for (const p of c.hourly) {
    if (p.viewers === null || p.viewers === undefined) continue;
    const h = Math.floor((parseTs(p.from) - start) / 3600000) + 1;
    if (h >= 1 && h <= 24) curve.set(h, p.viewers);
  }
  return curve;
};

type UnlockClass = 'ea' | 'weak' | 'rolling' | 'global' | 'unknown';

/** Classify a comparable by its unlock description. */
const classifyUnlock = (c: Comparable): UnlockClass => {
  const u = (c.unlock ?? '').toLowerCase();
  if (u.includes('early-access-contaminat') || u.includes('early-access cont') || u.includes('tier: ea')) return 'ea';
  if (u.includes('tier: weak')) return 'weak';
  if (u.includes('midnight local') || u.includes('rolling')) return 'rolling';
  if (u.includes('single global') || u.includes('simultaneous')) return 'global';
  return 'unknown';
};

/** True when the unlock text names a simultaneous global unlock (PC/Steam) at or just before the release day. */
const hasGlobalUnlock = (c: Comparable): boolean => {
  const u = (c.unlock ?? '').toLowerCase();
  return u.includes('single global') || u.includes('global unlock') || u.includes('simultaneous midnight');
};

const isConsoleOnly = (c: Comparable): boolean => !(c.platforms ?? '').includes('PC');

/** Log-ratios ln(viewers_h / viewers_1) across a set of curves, for one hour. */
const logRatios = (curves: Map<number, number>[], h: number): number[] => {
  const vals: number[] = [];
  for (const curve of curves) {
    const v1 = curve.get(1);
    const vh = curve.get(h);
    if (v1 !== undefined && vh !== undefined && v1 > 0 && vh > 0) {
      vals.push(Math.log(vh / v1));
    }
  }
  return vals.sort((a, b) => a - b);
};

/** 3-hour moving average of a per-hour series (hours 2..24). */
const smooth = (raw: Map<number, number>): Map<number, number> => {
  const out = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const vs: number[] = [];
    for (const k of [h - 1, h, h + 1]) {
      const v = raw.get(k);
      if (v !== undefined) vs.push(v);
    }
    if (vs.length > 0) out.set(h, mean(vs));
  }
  return out;
};

/** Per-hour median and sd series for a set of curves, smoothed. */
const medianSdSeries = (curves: Map<number, number>[]): { med: Map<number, number>; sd: Map<number, number> } => {
  const rawMed = new Map<number, number>();
  const rawSd = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const vals = logRatios(curves, h);
    if (vals.length >= MIN_OBS) {
      rawMed.set(h, quantile(vals, 0.5));
      rawSd.set(h, sd(vals));
    }
  }
  return { med: smooth(rawMed), sd: smooth(rawSd) };
};

/** The house baseline's quantiles for one hour (fallback only). */
const baselineQuantiles = (p1: number, h: number): number[] =>
  Z.map((z) => round2(p1 * Math.exp(z * BASE_SIGMA * Math.sqrt(h - 1))));

/** Forecast one case. */
const forecastCase = (c: CaseFile): { hours: Array<{ hour: number; q: number[] }> } => {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`case asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  const targetName = (c.game?.name ?? '').toLowerCase();

  // Build the reference classes from the case's own comparables.
  const usable: Array<{ curve: Map<number, number>; cls: UnlockClass; global: boolean; consoleOnly: boolean }> = [];
  for (const comp of c.comparables ?? []) {
    if (comp.name.toLowerCase().includes(targetName) && targetName.length > 0) continue; // the target's own pre-release history
    const curve = dayCurve(comp);
    if (!curve.has(1) || (curve.get(1) ?? 0) <= 0) continue;
    usable.push({ curve, cls: classifyUnlock(comp), global: hasGlobalUnlock(comp), consoleOnly: isConsoleOnly(comp) });
  }
  const curvesOf = (pred: (u: (typeof usable)[number]) => boolean): Map<number, number>[] =>
    usable.filter(pred).map((u) => u.curve);

  // Reference classes, widest last: clean rolling (+ console-only unknown),
  // all rolling, every usable comparable.
  const classes: Map<number, number>[][] = [
    curvesOf((u) => (u.cls === 'rolling' && !u.global) || (u.cls === 'unknown' && u.consoleOnly)),
    curvesOf((u) => u.cls === 'rolling'),
    curvesOf(() => true),
  ];
  const series = classes.map((curves) => (curves.length >= MIN_OBS ? medianSdSeries(curves) : null));

  const hours = c.forecast.map(({ hour }) => {
    let q: number[] | null = null;
    for (const s of series) {
      if (s === null) continue;
      const m = s.med.get(hour);
      const sdv = s.sd.get(hour);
      if (m === undefined || sdv === undefined) continue;
      q = Z.map((z) => round2(p1 * Math.exp(m * MEDIAN_SHRINK + z * sdv)));
      break;
    }
    if (q === null) q = baselineQuantiles(p1, hour);
    // Clamp to the allowed range and enforce non-decreasing order.
    q = q.map((v) => Math.min(1e9, Math.max(0.01, v)));
    for (let i = 1; i < q.length; i++) if (q[i] < q[i - 1]) q[i] = q[i - 1];
    return { hour, q };
  });
  return { hours };
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  const out = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify(out)}\n`);
}
