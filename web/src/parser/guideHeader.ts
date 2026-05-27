// Parses the most-consulted setup facts out of a guiding section's raw PHD2
// header lines (already captured verbatim in GuideSession.hdr). Pure and
// presentation-free so the rules can be locked down with unit tests.
//
// PHD2 convention: the RA-axis guide algorithm is logged as "X guide
// algorithm" and the Dec-axis as "Y guide algorithm" (PHD2 Mount class:
// m_pXGuideAlgorithm = RA, m_pYGuideAlgorithm = Dec). We surface them as
// RA / Dec accordingly.

export interface AlgoInfo {
  /** Algorithm name, e.g. "Hysteresis", "Resist Switch", "Lowpass2". */
  name: string;
  /** Tidied, already-labeled secondary parameter: "agg 0.45" | "aggr 32" |
   *  "slope wt 5", or null when the line exposes none. */
  param: string | null;
  /** Tidied minimum-move value, e.g. "0.2", "0.098". */
  minMove: string | null;
}

export interface GuideHeaderInfo {
  pierSide: string | null;   // "West" | "East"
  hourAngle: string | null;  // hours, e.g. "-6.00" (unit appended in the view)
  altitude: string | null;   // degrees, e.g. "20.1"
  rotator: string | null;    // degrees when present; null for "N/A"/absent
  backlash: { enabled: boolean; pulseMs: string } | null;
  ra: AlgoInfo | null;
  dec: AlgoInfo | null;
}

/** Strip trailing zeros after a decimal point (and a dangling dot), keeping a
 *  trailing '%'. "0.450"->"0.45", "32.000"->"32", "0.200"->"0.2", "100%"->"100%".
 *  Mirrors the trailing-zero trimming in parseInfo.ts. */
const tidyNum = (s: string): string => {
  const pct = s.endsWith('%') ? '%' : '';
  const n = pct ? s.slice(0, -1) : s;
  if (!n.includes('.')) return n + pct;
  return n.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + pct;
};

const firstMatch = (hdr: string[], re: RegExp): RegExpMatchArray | null => {
  for (const line of hdr) {
    const m = line.match(re);
    if (m) return m;
  }
  return null;
};

const parseAlgo = (line: string | undefined): AlgoInfo | null => {
  if (!line) return null;
  const eq = line.indexOf('= ');
  if (eq < 0) return null;
  const body = line.slice(eq + 2);

  // Name = text up to the first comma. Preserves spaces inside the name
  // ("Resist Switch"); the comma (or, for the comma-less Resist Switch tail,
  // the run of " Key =" pairs) never appears inside a name.
  const comma = body.indexOf(',');
  const name = (comma >= 0 ? body.slice(0, comma) : body).trim();

  const minMoveM = line.match(/Minimum move = ([\d.]+)/);
  const minMove = minMoveM ? tidyNum(minMoveM[1]) : null;

  // Secondary param, in priority order: Aggression (fraction or percent) ->
  // Aggressiveness -> the first other "Key = number" that isn't Minimum move
  // or FastSwitch (e.g. Slope weight for plain Lowpass).
  let param: string | null = null;
  const agg = line.match(/Aggression = ([\d.]+%?)/);
  const aggr = line.match(/Aggressiveness = ([\d.]+)/);
  if (agg) {
    param = `agg ${tidyNum(agg[1])}`;
  } else if (aggr) {
    param = `aggr ${tidyNum(aggr[1])}`;
  } else {
    for (const m of line.matchAll(/([A-Za-z][A-Za-z ]*?) = ([\d.]+)/g)) {
      const key = m[1].trim();
      if (key === 'Minimum move' || key === 'FastSwitch') continue;
      const label =
        key === 'Slope weight' ? 'slope wt' :
        key === 'Hysteresis' ? 'hyst' :
        key.toLowerCase();
      param = `${label} ${tidyNum(m[2])}`;
      break;
    }
  }

  return { name, param, minMove };
};

export const parseGuideHeader = (hdr: string[]): GuideHeaderInfo => {
  const coord = hdr.find((l) => l.includes('Pier side =')) ?? '';
  const pierSide = (coord.match(/Pier side = ([^,]+)/)?.[1] ?? '').trim() || null;
  const hourAngle = coord.match(/Hour angle = (-?[\d.]+)/)?.[1] ?? null;
  const altitude = coord.match(/Alt = (-?[\d.]+)/)?.[1] ?? null;
  const rotRaw = (coord.match(/Rotator pos = ([^,]+)/)?.[1] ?? '').trim();
  const rotator = rotRaw && rotRaw.toUpperCase() !== 'N/A' ? rotRaw : null;

  const bl = firstMatch(hdr, /Backlash comp = (enabled|disabled), pulse = (\d+) ms/);
  const backlash = bl ? { enabled: bl[1] === 'enabled', pulseMs: bl[2] } : null;

  return {
    pierSide,
    hourAngle,
    altitude,
    rotator,
    backlash,
    ra: parseAlgo(hdr.find((l) => l.startsWith('X guide algorithm'))),
    dec: parseAlgo(hdr.find((l) => l.startsWith('Y guide algorithm'))),
  };
};
