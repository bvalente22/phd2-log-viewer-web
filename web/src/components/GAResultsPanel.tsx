import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { extractGAResults, type GARecommendationRun } from '../parser/gaResults';

const fmtClock = (sessionStartsMs: number | null, dt: number | undefined): string | null => {
  if (sessionStartsMs == null || dt == null) return null;
  const d = new Date(sessionStartsMs + dt * 1000);
  // Locale-default time-of-day so it matches what the user sees in the
  // Recents list / SectionList. We avoid date prefixes here; the run
  // already lives inside a section that's titled with the date.
  return d.toLocaleTimeString();
};

const fmtElapsed = (start: number | undefined, end: number | undefined): string | null => {
  if (start == null || end == null) return null;
  const sec = Math.max(0, Math.round(end - start));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
};

/**
 * PHD2 emits multiple metrics joined by commas on a single GA Result
 * line, e.g.
 *   "SNR=296.3, Samples=52, Elapsed Time=218s, RA HPF-RMS= 0.01 px (  0.04 arc-sec ), …"
 * We split on top-level commas (i.e. commas not inside parentheses,
 * since the arc-sec parenthetical sometimes contains commas in
 * localized PHD2 builds) so the panel can render each metric on its
 * own line for legibility.
 */
const splitMetricLine = (line: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      const piece = line.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const tail = line.slice(start).trim();
  if (tail) out.push(tail);
  return out;
};

interface RunCardProps {
  run: GARecommendationRun;
  startsMs: number | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

const RunCard = ({ run, startsMs, t }: RunCardProps) => {
  const clock = fmtClock(startsMs, run.startTime);
  const elapsed = fmtElapsed(run.startTime, run.endTime);
  const subtitleParts: string[] = [];
  if (clock) subtitleParts.push(clock);
  if (elapsed) subtitleParts.push(t('ga.runDuration', { duration: elapsed }));
  if (run.endIdx == null) subtitleParts.push(t('ga.runUnclosed'));
  const subtitle = subtitleParts.join(' · ');

  return (
    <div className="rounded border border-slate-700 bg-slate-800/40 p-2">
      <div className="text-[11px] text-slate-400">
        {t('ga.runTitle')}
        {subtitle && <span className="text-slate-500"> — {subtitle}</span>}
      </div>
      {run.recommendations.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs text-slate-200">
          {run.recommendations.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {run.metrics.length > 0 && (
        <details className="mt-2 text-[11px] text-slate-400" title={t('ga.metricsTooltip')}>
          <summary className="cursor-pointer select-none hover:text-slate-300">
            {t('ga.metrics', { count: run.metrics.length })}
          </summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] leading-tight text-slate-300">
            {run.metrics.flatMap(splitMetricLine).map((piece, i) => (
              <li key={i}>{piece}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

/**
 * Strip above the chart that surfaces every Guiding Assistant run found
 * in the active session — the desktop log viewer leaves these buried as
 * info-event hover text, which is fiddly to read across multiple
 * recommendation lines. We list them all in a collapsible card per run
 * with the recommendation lines as a bulleted list and the raw GA
 * metrics tucked behind a `<details>` so they're available but don't
 * dominate the strip.
 *
 * The component renders nothing when the active section isn't a guiding
 * session or when no GA runs are present, so it doesn't bloat the
 * chrome on logs that never invoked the assistant.
 */
export function GAResultsPanel() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const runs = useMemo<GARecommendationRun[]>(() => {
    if (!log || sectionIdx < 0) return [];
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return [];
    const session = log.sessions[sec.idx];
    return extractGAResults(session);
  }, [log, sectionIdx]);

  if (runs.length === 0) return null;

  const session = log!.sessions[log!.sections[sectionIdx].idx];

  // Default-collapsed (PR 2026-05-27): the run cards were pushing the
  // chart down on every GA-bearing session. The summary line stays
  // visible so the feature is still discoverable; one click expands it.
  return (
    <details
      // Sky-tinted accent so the GA strip stands out from the
      // adjacent neutral SectionHeader strip — the user couldn't
      // tell at a glance that the panel was a separate, expandable
      // section. The sky-* palette isn't overridden by any theme
      // (themes only retint the slate-* surface classes), so this
      // accent stays vivid in Dark / Paper / High contrast / Night.
      className="border-y-2 border-sky-500/60 bg-sky-900/20 px-3 py-1 text-xs"
      title={t('ga.summaryTooltip')}
    >
      <summary className="cursor-pointer select-none font-semibold text-sky-300 hover:text-sky-200">
        {t('ga.summary', { count: runs.length })}
      </summary>
      <div className="mt-2 space-y-2 pb-1">
        {runs.map((run, i) => (
          <RunCard key={i} run={run} startsMs={session.startsMs} t={t} />
        ))}
      </div>
    </details>
  );
}
