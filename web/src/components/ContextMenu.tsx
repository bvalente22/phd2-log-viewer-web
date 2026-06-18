import * as RCM from '@radix-ui/react-context-menu';
import { ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
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

export function GraphContextMenu({ children }: { children: ReactNode }) {
  const { t } = useTranslation('toolbar');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const includeAll = useViewStore((s) => s.includeAll);
  const excludeAll = useViewStore((s) => s.excludeAll);
  const exclusions = useViewStore((s) => s.exclusions);
  const settlingPolicy = useViewStore((s) => s.settlingPolicy);
  const applySettlingPolicy = useViewStore((s) => s.applySettlingPolicy);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const activePolicy = sessionIdx >= 0 ? (settlingPolicy.get(sessionIdx) ?? 'desktop') : 'desktop';

  const openAnalysis = useAnalysisStore((s) => s.open);
  const scaleModeForAnalysis = useViewStore((s) => s.scaleMode);
  const sessionMask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;

  // Gate on the same masked input runAnalysis() uses below — the
  // modal opens with auto-mask applied by default.
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
      // Initial garun applies the section's auto-derived
      // dither/settling mask. The "all frames" toolbar toggle starts
      // OFF (showing "auto-mask") and the user can flip it ON to
      // re-analyze without the mask.
      const garun = analyze(session, { range: r, undoRaCorrections, mask: sessionMask });
      // Pre-compute the counterpart for the switchable kinds so the
      // periodogram can render both at once and the mode tabs swap
      // instantly. analyze() is fast (sub-millisecond on typical
      // sessions) so the eager second pass is invisible to the user.
      // 'unguided' has no flipped counterpart.
      let garunOther: typeof garun | null = null;
      if (kind === 'all' || kind === 'all-raw-ra') {
        garunOther = analyze(session, { range: r, undoRaCorrections: !undoRaCorrections, mask: sessionMask });
      }
      // Spike analysis runs lazily inside the modal (the user may never
      // open the spike tab), so we just hand over the source params.
      // analyzeSpikes is in the same ~1 ms range as analyze() so the
      // first switch into the spike tab is also imperceptible.
      openAnalysis({
        garun, garunOther, kind,
        initialScaleMode: scaleModeForAnalysis,
        spikeSource: { session, range: r, mask: sessionMask },
      });
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
            title={t('contextMenu.includeAllTooltip')}
          >
            {t('contextMenu.includeAll')}
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && excludeAll(sessionIdx, session.entries.length)}
            title={t('contextMenu.excludeAllTooltip')}
          >
            {t('contextMenu.excludeAll')}
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
            {t('contextMenu.settlingCaption')}
          </div>
          <Item
            disabled={!session}
            onSelect={() => session && applySettlingPolicy(sessionIdx, session, 'desktop')}
            title={t('contextMenu.excludeSettlingTooltip')}
          >
            <span className="me-1 inline-block w-4 text-emerald-400">{activePolicy === 'desktop' ? '✓' : ''}</span>
            {t('contextMenu.excludeSettling')}
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && applySettlingPolicy(sessionIdx, session, 'web')}
            title={t('contextMenu.excludeSettlingDithersTooltip')}
          >
            <span className="me-1 inline-block w-4 text-emerald-400">{activePolicy === 'web' ? '✓' : ''}</span>
            {t('contextMenu.excludeSettlingDithers')}
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item
            disabled={!session}
            onSelect={() => session && includeAll(sessionIdx, session.entries.length)}
            title={t('contextMenu.resetSectionTooltip')}
          >
            {t('contextMenu.resetSection')}
          </Item>
          <Item
            onSelect={() => window.dispatchEvent(new CustomEvent('phd-reset-zoom'))}
            title={t('contextMenu.resetZoomTooltip')}
          >
            {t('contextMenu.resetZoom')}
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          {/* Single Analysis entry. Defaults to mode='all-raw-ra' (Raw
              RA, undoRaCorrections=true) — matches the original
              desktop's startup view. The user toggles to 'all'
              (Residual error) from inside the modal via the mode tabs. */}
          <Item
            disabled={!session || !canAnalyzeSession}
            onSelect={() => session && runAnalysis('all-raw-ra', true)}
            title={t('contextMenu.analysisTooltip')}
          >
            {t('contextMenu.analysis')}
          </Item>
          {isUnguided && (
            <Item
              disabled={!canAnalyzeUnguided}
              onSelect={() => {
                if (!session) return;
                const range = pickUnguidedRange();
                if (range) runAnalysis('unguided', false, range);
              }}
              title={t('contextMenu.analyzeUnguidedTooltip')}
            >
              {t('contextMenu.analyzeUnguided')}
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
      {hint && <span className="ms-3 text-xs text-slate-500">{hint}</span>}
    </RCM.Item>
  );
}
