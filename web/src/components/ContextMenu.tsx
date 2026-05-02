import * as RCM from '@radix-ui/react-context-menu';
import { ReactNode, useRef } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';
import { canAnalyze, analyze, findUnguidedWindow, findUnguidedWindowAtTime } from '../parser/analyze';
import type { AnalysisKind } from '../state/analysisStore';
import { useAnalysisStore } from '../state/analysisStore';

interface PlotlyContainerEl extends HTMLElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number] };
  };
}

/**
 * Translate a viewport-coordinate `clientX` (from a contextmenu event) into
 * the equivalent data-X on the rendered Plotly chart that received the
 * click. Returns null when the cursor wasn't actually over a chart's plot
 * area (e.g. right-click happened on a sidebar) or Plotly's internal
 * layout coords aren't ready.
 */
const clientXToChartTime = (clientX: number, target: HTMLElement | null): number | null => {
  if (!target) return null;
  const plot = target.closest('.js-plotly-plot') as PlotlyContainerEl | null;
  const xa = plot?._fullLayout?.xaxis;
  if (!plot || !xa || !xa._length) return null;
  const rect = plot.getBoundingClientRect();
  const px = clientX - rect.left - xa._offset;
  if (px < 0 || px > xa._length) return null;
  const frac = px / xa._length;
  return xa.range[0] + frac * (xa.range[1] - xa.range[0]);
};

const DITHER_SETTLE_FRAMES = 5;

/**
 * Build an exclusion mask covering frames during settling and post-dither
 * settle. Two paths:
 *   - If the log emits SETTLING STATE CHANGE state=1/0 events, exclude the
 *     entry range bounded by those events (matches desktop "Exclude frames
 *     settling").
 *   - As a fallback (newer logs may only emit DITHER), also exclude the
 *     N entries immediately following any DITHER event.
 *
 * The result is always OR-merged with the caller's existing mask so picking
 * this menu item adds to whatever the user has already excluded by hand.
 */
const computeSettlingMask = (s: GuideSession, base?: Uint8Array): Uint8Array => {
  const m = base && base.length === s.entries.length
    ? new Uint8Array(base)
    : new Uint8Array(s.entries.length);

  let inSettle = false;
  let startEntryIdx = 0;
  for (const info of s.infos) {
    if (info.info === 'state=1' && !inSettle) {
      inSettle = true;
      startEntryIdx = info.idx;
    } else if (info.info === 'state=0' && inSettle) {
      for (let i = startEntryIdx; i < info.idx && i < s.entries.length; i++) m[i] = 1;
      inSettle = false;
    }
  }
  if (inSettle) {
    for (let i = startEntryIdx; i < s.entries.length; i++) m[i] = 1;
  }

  for (const info of s.infos) {
    if (info.info.startsWith('DITHER')) {
      const stop = Math.min(s.entries.length, info.idx + DITHER_SETTLE_FRAMES);
      for (let i = info.idx; i < stop; i++) m[i] = 1;
    }
  }

  return m;
};

export function GraphContextMenu({ children }: { children: ReactNode }) {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const includeAll = useViewStore((s) => s.includeAll);
  const excludeAll = useViewStore((s) => s.excludeAll);
  const setMask = useViewStore((s) => s.setMask);
  const exclusions = useViewStore((s) => s.exclusions);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;

  const openAnalysis = useAnalysisStore((s) => s.open);
  const scaleModeForAnalysis = useViewStore((s) => s.scaleMode);
  const sessionMask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;

  const canAnalyzeSession = session
    ? canAnalyze(session, {
        range: { begin: 0, end: session.entries.length },
        undoRaCorrections: false,
        mask: sessionMask,
      })
    : false;

  // Time of the most recent right-click within a chart's plot area, in
  // session-elapsed seconds. Set by the contextmenu capture handler below
  // and read when the user picks "Analyze unguided section" — lets the
  // user choose *which* unguided window to analyze (in sessions with more
  // than one) by right-clicking inside it. Falls back to the first window
  // when the cursor wasn't over the chart at right-click time.
  const lastClickTimeRef = useRef<number | null>(null);

  const firstUnguidedRange = session ? findUnguidedWindow(session) : null;
  const isUnguided = !!firstUnguidedRange;

  /** Pick the unguided window the user actually right-clicked on, falling
   * back to the first one in the session. */
  const pickUnguidedRange = (): { begin: number; end: number } | null => {
    if (!session) return null;
    const t = lastClickTimeRef.current;
    if (t !== null) {
      const atClick = findUnguidedWindowAtTime(session, t);
      if (atClick) return atClick;
    }
    return firstUnguidedRange;
  };

  const canAnalyzeUnguided = !!session && !!firstUnguidedRange && canAnalyze(session, {
    range: firstUnguidedRange,
    undoRaCorrections: false,
    mask: sessionMask,
  });

  const runAnalysis = (kind: AnalysisKind, undoRaCorrections: boolean, range?: { begin: number; end: number }) => {
    if (!session) return;
    const r = range ?? { begin: 0, end: session.entries.length };
    try {
      const garun = analyze(session, { range: r, undoRaCorrections, mask: sessionMask });
      openAnalysis({ garun, kind, initialScaleMode: scaleModeForAnalysis });
    } catch (err) {
      // canAnalyze gates the call site, but stay defensive — if analyze
      // throws (insufficient entries after edge-case filtering), surface
      // it via console for now.
      // eslint-disable-next-line no-console
      console.error('analyze failed:', err);
    }
  };

  return (
    <RCM.Root>
      {/* Capturing the contextmenu event on the trigger lets us record where
          the cursor was at right-click time. Radix re-fires its own
          contextmenu handler after this — capture phase keeps both running. */}
      <RCM.Trigger
        asChild
        onContextMenu={(e) => {
          lastClickTimeRef.current = clientXToChartTime(e.clientX, e.target as HTMLElement);
        }}
      >
        {children}
      </RCM.Trigger>
      <RCM.Portal>
        <RCM.Content className="min-w-[16rem] rounded border border-slate-700 bg-slate-900 p-1 text-sm shadow-lg">
          <Item
            disabled={!session}
            onSelect={() => session && includeAll(sessionIdx, session.entries.length)}
            title="Re-include every frame; clears all exclusions in this section"
          >
            Include all frames
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && excludeAll(sessionIdx, session.entries.length)}
            title="Mark every frame as excluded from the analysis"
          >
            Exclude all frames
          </Item>
          <Item
            disabled={!session}
            onSelect={() => {
              if (!session) return;
              // OR with whatever the user has already excluded by hand.
              const current = exclusions.get(sessionIdx);
              setMask(sessionIdx, computeSettlingMask(session, current));
            }}
            title="Add settling windows (and frames just after each DITHER event) to the existing exclusions"
          >
            Exclude dithers / settling
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item
            disabled={!session}
            onSelect={() => session && includeAll(sessionIdx, session.entries.length)}
            title="Reset this section's exclusions to its loaded state"
          >
            Reset section
          </Item>
          <Item
            onSelect={() => window.dispatchEvent(new CustomEvent('phd-reset-zoom'))}
            title="Auto-fit the X and Y axes to the full data range"
          >
            Reset zoom
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item
            disabled={!session || !canAnalyzeSession}
            onSelect={() => session && runAnalysis('all', false)}
            title="Analyze every included, non-excluded frame: drift-corrected timeline + FFT periodogram"
          >
            Analyze selected frames
          </Item>
          <Item
            disabled={!session || !canAnalyzeSession}
            onSelect={() => session && runAnalysis('all-raw-ra', true)}
            title="Same range, but with RA corrections re-added — shows what tracking would have looked like unguided"
          >
            Analyze selected, raw RA
          </Item>
          {isUnguided && (
            <Item
              disabled={!canAnalyzeUnguided}
              onSelect={() => {
                if (!session) return;
                const range = pickUnguidedRange();
                if (range) runAnalysis('unguided', false, range);
              }}
              title="Analyze the unguided window under the cursor (or the first one in the session if you right-clicked elsewhere)"
            >
              Analyze unguided section
            </Item>
          )}
        </RCM.Content>
      </RCM.Portal>
    </RCM.Root>
  );
}

function Item({ children, onSelect, disabled, hint, title }: {
  children: ReactNode; onSelect?: () => void; disabled?: boolean; hint?: string; title?: string;
}) {
  return (
    <RCM.Item
      disabled={disabled}
      onSelect={onSelect}
      title={title}
      className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 outline-none ${
        disabled ? 'text-slate-500' : 'text-slate-100 data-[highlighted]:bg-slate-800'
      }`}
    >
      <span>{children}</span>
      {hint && <span className="ml-3 text-xs text-slate-500">{hint}</span>}
    </RCM.Item>
  );
}
