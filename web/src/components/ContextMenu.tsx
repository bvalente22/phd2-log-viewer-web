import * as RCM from '@radix-ui/react-context-menu';
import { ReactNode } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

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
  const isUnguided = !!session && session.entries.length > 0 && !session.entries[0].guiding;

  return (
    <RCM.Root>
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <RCM.Portal>
        <RCM.Content className="min-w-[16rem] rounded border border-slate-700 bg-slate-900 p-1 text-sm shadow-lg">
          <Item
            disabled={!session}
            onSelect={() => session && includeAll(sessionIdx, session.entries.length)}
          >
            Include all frames
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && excludeAll(sessionIdx, session.entries.length)}
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
          >
            Exclude dithers / settling
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item
            disabled={!session}
            onSelect={() => session && includeAll(sessionIdx, session.entries.length)}
          >
            Reset section
          </Item>
          <Item onSelect={() => window.dispatchEvent(new CustomEvent('phd-reset-zoom'))}>
            Reset zoom
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item disabled hint="v3">Analyze selected frames</Item>
          <Item disabled hint="v3">Analyze selected, raw RA</Item>
          {isUnguided && <Item disabled hint="v3">Analyze unguided section</Item>}
        </RCM.Content>
      </RCM.Portal>
    </RCM.Root>
  );
}

function Item({ children, onSelect, disabled, hint }: {
  children: ReactNode; onSelect?: () => void; disabled?: boolean; hint?: string;
}) {
  return (
    <RCM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 outline-none ${
        disabled ? 'text-slate-500' : 'text-slate-100 data-[highlighted]:bg-slate-800'
      }`}
    >
      <span>{children}</span>
      {hint && <span className="ml-3 text-xs text-slate-500">{hint}</span>}
    </RCM.Item>
  );
}
