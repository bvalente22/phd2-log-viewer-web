/**
 * Pure 1-D de-overlap for the numbered peak chips under the periodogram.
 *
 * Each chip wants to sit centered on its peak's x (screen px). When two peaks
 * are close — e.g. 83.5s and 87.6s on a log axis — their chips would stack on
 * top of each other and hide a rank. Instead, chips that would collide are
 * spread sideways into an evenly spaced run, `minGap` px apart, centered on
 * the mean of their true positions. Left-to-right order is preserved, so each
 * chip still sits on the same side as its own dotted line, and the colors tie
 * them together.
 *
 * Classic cluster merge: walk the chips in x order, start each as its own
 * cluster, and merge it into the previous cluster while their spread runs
 * would come closer than `minGap`. A merge re-centers the combined run, which
 * can make it collide with the cluster before it, so merging repeats until
 * the run clears its neighbor. Chips that don't collide are left exactly
 * where they are.
 *
 * Returns the new x for each input, in input order.
 */
export function spreadMarkers(xs: readonly number[], minGap: number): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
  const clusters: { idx: number[]; center: number }[] = [];
  const halfSpan = (c: { idx: number[] }) => ((c.idx.length - 1) / 2) * minGap;
  for (const i of order) {
    clusters.push({ idx: [i], center: xs[i] });
    while (clusters.length > 1) {
      const b = clusters[clusters.length - 1];
      const a = clusters[clusters.length - 2];
      if (b.center - halfSpan(b) - (a.center + halfSpan(a)) >= minGap) break;
      const idx = [...a.idx, ...b.idx];
      const center = idx.reduce((sum, k) => sum + xs[k], 0) / idx.length;
      clusters.splice(-2, 2, { idx, center });
    }
  }
  const out = new Array<number>(xs.length);
  for (const c of clusters) {
    const start = c.center - halfSpan(c);
    c.idx.forEach((k, j) => { out[k] = start + j * minGap; });
  }
  return out;
}
