// The mount worm-period catalog is loaded straight from the canonical TSV at
// the repo root — there is deliberately no copy of this data in the source.
// `?raw` inlines the file's text at build time, so refreshing the catalog is a
// matter of replacing the .tsv and pushing (Pages redeploys on every push to
// main); no code change, no second copy to drift out of sync.
//
// Because the data is expected to change, nothing here may depend on specific
// manufacturers, models, counts, or ordering.
import catalogTsv from '../../../mountData/telescope_mount_worm_periods.tsv?raw';

export interface MountCatalogEntry {
  manufacturer: string;
  model: string;
  /** Worm period in seconds. Always finite and > 0 — bad rows are dropped. */
  wormPeriodSec: number;
  /** Stable identity for the <option> value: manufacturer + model. */
  key: string;
}

/**
 * Parse the mount catalog TSV: `Manufacturer <tab> Model <tab> worm period`.
 *
 * Deliberately forgiving, because this file is maintained by hand and updated
 * out-of-band from the code: blank lines, comment lines (`#`), a leading BOM,
 * CRLF endings, stray whitespace, extra trailing columns, and a header row are
 * all tolerated. A row that can't yield a positive finite period is skipped
 * rather than throwing — one bad line must not blank the whole dropdown.
 *
 * The header is detected by its unparseable period column, so the parser
 * doesn't depend on the exact header text either.
 */
export function parseMountCatalog(text: string): MountCatalogEntry[] {
  const out: MountCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const cols = rawLine.split('\t');
    if (cols.length < 3) continue;

    const manufacturer = cols[0].trim();
    const model = cols[1].trim();
    // Tolerate a period written as "384.00 s" or with a stray comma.
    const period = parseFloat(cols[2].trim().replace(',', '.'));

    if (!manufacturer || !model) continue;
    if (!Number.isFinite(period) || period <= 0) continue; // header + junk rows

    const key = `${manufacturer} ${model}`;
    if (seen.has(key)) continue; // first entry wins on a duplicate
    seen.add(key);

    out.push({
      manufacturer,
      model,
      wormPeriodSec: Math.round(period * 100) / 100,
      key,
    });
  }

  out.sort((a, b) =>
    a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model));
  return out;
}

/** Group entries by manufacturer, preserving the sorted order, for <optgroup>. */
export function groupByManufacturer(
  entries: MountCatalogEntry[],
): Array<{ manufacturer: string; entries: MountCatalogEntry[] }> {
  const groups: Array<{ manufacturer: string; entries: MountCatalogEntry[] }> = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.manufacturer === e.manufacturer) last.entries.push(e);
    else groups.push({ manufacturer: e.manufacturer, entries: [e] });
  }
  return groups;
}

/** The parsed catalog. Empty if the TSV is missing or unusable. */
export const MOUNT_CATALOG: MountCatalogEntry[] = parseMountCatalog(catalogTsv);
