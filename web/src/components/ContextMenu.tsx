import * as RCM from '@radix-ui/react-context-menu';
import { ReactNode } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

const computeSettlingMask = (s: GuideSession): Uint8Array => {
  const m = new Uint8Array(s.entries.length);
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
  return m;
};

export function GraphContextMenu({ children }: { children: ReactNode }) {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const includeAll = useViewStore((s) => s.includeAll);
  const excludeAll = useViewStore((s) => s.excludeAll);
  const setMask = useViewStore((s) => s.setMask);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const isUnguided = !!session && session.entries.length > 0 && !session.entries[0].guiding;

  return (
    <RCM.Root>
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <RCM.Portal>
        <RCM.Content className="min-w-[14rem] rounded border border-slate-700 bg-slate-900 p-1 text-sm shadow-lg">
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
            onSelect={() => session && setMask(sessionIdx, computeSettlingMask(session))}
          >
            Exclude frames settling
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item disabled hint="Coming in v3">Analyze selected frames</Item>
          <Item disabled hint="Coming in v3">Analyze selected, raw RA</Item>
          {isUnguided && <Item disabled hint="Coming in v3">Analyze unguided section</Item>}
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
