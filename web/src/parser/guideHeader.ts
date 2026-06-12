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
  pierSide: string | null;     // "West" | "East"
  hourAngle: string | null;    // hours, e.g. "-6.00" (unit appended in the view)
  declination: string | null;  // degrees, e.g. "47.0" (the sky Dec, NOT the Dec
                               //   guide algorithm — that's `dec` below)
  altitude: string | null;     // degrees, e.g. "20.1"
  azimuth: string | null;      // degrees, e.g. "25.1"
  rotator: string | null;      // degrees when present; null for "N/A"/absent
  backlash: { enabled: boolean; pulseMs: string } | null;
  ra: AlgoInfo | null;
  dec: AlgoInfo | null;
  exposure: string | null;     // raw exposure in ms, e.g. "2000"
  aoPresent: boolean;          // an "AO = …" line exists in the header
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
      if (key === 'Minimum move') continue;  // already surfaced as minMove
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

// Predictive PEC logs the control gain on the "X guide algorithm" line and the
// prediction gain on its own following line. Surface both with short labels
// (consistent with the agg/min/hyst code-side labels). Returns null when
// neither gain is present (caller keeps the generic param).
const ppecParam = (xLine: string, hdr: string[]): string | null => {
  const ctrl = xLine.match(/Control gain = ([\d.]+)/)?.[1];
  const pred = firstMatch(hdr, /Prediction gain = ([\d.]+)/)?.[1];
  const parts: string[] = [];
  if (ctrl) parts.push(`ctrl ${tidyNum(ctrl)}`);
  if (pred) parts.push(`pred ${tidyNum(pred)}`);
  return parts.length ? parts.join(' · ') : null;
};

export const parseGuideHeader = (hdr: string[]): GuideHeaderInfo => {
  // The coordinate line is identical between guiding and calibration sections:
  //   RA = .. hr, Dec = .. deg, Hour angle = .. hr, Pier side = .., Rotator
  //   pos = .., Alt = .. deg, Az = .. deg
  // so this one parser feeds both the GuidingDashboard and the
  // CalibrationDashboard. `Dec = ` (space-equals-space) matches only the sky
  // declination here, never "Dec Guide Speed = " or "Y guide algorithm".
  const coord = hdr.find((l) => l.includes('Pier side =')) ?? '';
  const pierSide = (coord.match(/Pier side = ([^,]+)/)?.[1] ?? '').trim() || null;
  const hourAngle = coord.match(/Hour angle = (-?[\d.]+)/)?.[1] ?? null;
  const declination = coord.match(/Dec = (-?[\d.]+)/)?.[1] ?? null;
  const altitude = coord.match(/Alt = (-?[\d.]+)/)?.[1] ?? null;
  const azimuth = coord.match(/Az = (-?[\d.]+)/)?.[1] ?? null;
  const rotRaw = (coord.match(/Rotator pos = ([^,]+)/)?.[1] ?? '').trim();
  const rotator = rotRaw && rotRaw.toUpperCase() !== 'N/A' ? rotRaw : null;

  const bl = firstMatch(hdr, /Backlash comp = (enabled|disabled), pulse = (\d+) ms/);
  const backlash = bl ? { enabled: bl[1] === 'enabled', pulseMs: bl[2] } : null;

  const xLine = hdr.find((l) => l.startsWith('X guide algorithm'));
  let ra = parseAlgo(xLine);
  if (ra && ra.name === 'Predictive PEC' && xLine) {
    ra = { ...ra, param: ppecParam(xLine, hdr) ?? ra.param };
  }

  const exposure = firstMatch(hdr, /Exposure = (\d+) ms/)?.[1] ?? null;
  const aoPresent = hdr.some((l) => l.startsWith('AO = '));

  return {
    pierSide,
    hourAngle,
    declination,
    altitude,
    azimuth,
    rotator,
    backlash,
    ra,
    dec: parseAlgo(hdr.find((l) => l.startsWith('Y guide algorithm'))),
    exposure,
    aoPresent,
  };
};
