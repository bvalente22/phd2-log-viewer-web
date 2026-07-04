import { useEffect, useState } from 'react';
import { getAnnotation, type Annotation } from '../storage/annotations';
import { useAnnotationStore } from '../state/annotationStore';
import type { RecentMeta } from '../storage/recents';

/**
 * Fetch the saved annotation (friendly name + notes) for each recent, keyed by
 * recent id. Re-fetches whenever the list changes or any annotation is
 * persisted (annotationStore.revision). Shared by the recents dropdown and the
 * history window so both label entries by friendly name identically.
 */
export function useRecentAnnotations(items: RecentMeta[]): Record<string, Annotation> {
  const [annos, setAnnos] = useState<Record<string, Annotation>>({});
  const revision = useAnnotationStore((s) => s.revision);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const map: Record<string, Annotation> = {};
      for (const r of items) {
        if (!r.hash) continue;
        const a = await getAnnotation(r.hash);
        if (a) map[r.id] = a;
      }
      if (!cancelled) setAnnos(map);
    })();
    return () => { cancelled = true; };
  }, [items, revision]);

  return annos;
}
