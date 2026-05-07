import { useEffect } from 'react';
import { useLogStore } from './logStore';
import { useViewStore } from './viewStore';

export function useKeyboardShortcuts() {
  const log = useLogStore((s) => s.log);
  const selected = useLogStore((s) => s.selectedSection);
  const select = useLogStore((s) => s.selectSection);
  const setVerticalMode = useViewStore((s) => s.setVerticalMode);
  // Trace-toggle shortcuts mirror the toolbar's master buttons. Each
  // remembers which sub-traces were visible the last time the group was
  // hidden (see toggleRaAxis / toggleDecAxis / toggleStarGroup in
  // viewStore.ts), so re-pressing the key restores the previous subset
  // rather than enabling everything.
  const toggleRaAxis = useViewStore((s) => s.toggleRaAxis);
  const toggleDecAxis = useViewStore((s) => s.toggleDecAxis);
  const toggleStarGroup = useViewStore((s) => s.toggleStarGroup);
  const toggleTrace = useViewStore((s) => s.toggleTrace);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore keys typed into text inputs / dropdowns, and IME
      // composition events. SELECT is in the skip list because pressing
      // a letter while a `<select>` has focus is the browser's
      // type-to-jump-to-option gesture; we don't want to clobber it.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.isComposing) return;
      if (!log) return;

      // Modifier-held variants (Ctrl/Cmd/Alt + letter) belong to the
      // browser or OS — refresh, bookmark, save, etc. — so we never
      // claim them. Shift is allowed because uppercase variants of the
      // same letter (e.g. "R" with caps lock) are intentional.
      const noMod = !e.ctrlKey && !e.metaKey && !e.altKey;

      if (e.key === 'p' || e.key === 'P') setVerticalMode('PAN');
      else if (e.key === 'z' || e.key === 'Z') setVerticalMode('ZOOM');
      else if (e.key === '[' && selected > 0) select(selected - 1);
      else if (e.key === ']' && selected < log.sections.length - 1) select(selected + 1);
      // Trace-toggle shortcuts only fire in time view, matching how the
      // toolbar disables the chips in scatter mode. State is read via
      // getState() to avoid re-binding the keydown listener on every
      // graphMode flip.
      else if (noMod && useViewStore.getState().graphMode === 'TIME') {
        if      (e.key === 'r' || e.key === 'R') toggleRaAxis();
        else if (e.key === 'd' || e.key === 'D') toggleDecAxis();
        else if (e.key === 's' || e.key === 'S') toggleStarGroup();
        else if (e.key === 'e' || e.key === 'E') toggleTrace('events');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, selected, select, setVerticalMode, toggleRaAxis, toggleDecAxis, toggleStarGroup, toggleTrace]);
}
