/**
 * Backlash Test (BLT) parser for PHD2 DEBUG logs.
 *
 * Ported from the original C# `BLTAnalyzer` (BLTSequence.cs / Form1.cs in
 * `HomeLab-Repos/PHDBacklashAnalyzer/`). See `docs/BLT_ANALYZER_SPEC.md`
 * for the algorithm spec — this file implements that spec verbatim,
 * including the deliberate quirks called out as "preserve" gotchas.
 *
 * Parsing model:
 *   - Stream the file line by line. Skip every line that doesn't contain
 *     "BLT" (case-insensitive). Real PHD2 debug logs have ~600k lines
 *     of which only a few thousand are BLT — pre-filter is essential.
 *   - A new test starts on every "BLT STARTING NORTH BACKLASH" line.
 *     Finalize the previous test (if any) via ComputeResult, then begin
 *     fresh.
 *   - Within a test, run a substring-match state machine that extracts
 *     numeric tokens via "find token, skip N chars, take next word".
 *
 * Output: array of BltSequence with both raw points (for charting) and
 * the ComputeResult summary (timestamp, pulseSize, blPx, blMs, etc).
 */

export interface BltSequence {
  /** HH:mm:ss timestamp from the "BLT STARTING NORTH BACKLASH" line. */
  timestamp: string;
  /** ms per north guide pulse, captured from the first "Moving North". */
  pulseSize: number;
  /** Raw Dec positions during the north phase. */
  northPoints: number[];
  /** Raw Dec positions during the south phase. */
  southPoints: number[];
  /** Consecutive differences in northPoints. */
  northDeltas: number[];
  /** Consecutive differences in southPoints. */
  southDeltas: number[];
  // ---- computed by ComputeResult ----
  /** Median of northDeltas (signed). */
  medianNorthMove: number;
  /** Guide rate in milliseconds per pixel. */
  northRate: number;
  /** South pulses needed to clear the backlash. */
  minSouthMoves: number;
  /** Backlash in pixels. */
  blPx: number;
  /** Backlash in milliseconds (= blPx × northRate). */
  blMs: number;
}

// =================================================================
// Numeric-extraction helpers — token-find + skip + word
// =================================================================

/** Case-insensitive substring search returning the index just after the
 *  matched token, or -1 if the token wasn't found. */
function findAfter(line: string, token: string): number {
  const upper = line.toUpperCase();
  const idx = upper.indexOf(token.toUpperCase());
  if (idx < 0) return -1;
  return idx + token.length;
}

/** Read the next whitespace/comma-delimited word starting at offset `from`,
 *  parsed as a Number. Returns NaN on parse failure. The C# original
 *  uses `string.Split(' ', ',', '=')`-style tokenization — we mimic it. */
function readNumberAfter(line: string, from: number): number {
  // Advance past any leading whitespace/separator.
  let i = from;
  while (i < line.length && (line[i] === ' ' || line[i] === ',' || line[i] === '=')) i++;
  let j = i;
  while (j < line.length && line[j] !== ' ' && line[j] !== ',' && line[j] !== '\r' && line[j] !== '\n') j++;
  return Number(line.slice(i, j));
}

/** "Find token, skip skipAmt chars (the punctuation after the token),
 *  take next word as Number." Mirrors the C# helper used in the original
 *  parser. */
function extractNumber(line: string, token: string, skipAmt: number): number {
  const after = findAfter(line, token);
  if (after < 0) return NaN;
  return readNumberAfter(line, after + skipAmt);
}

// =================================================================
// Statistics helpers — small, tested, no external dep
// =================================================================

function median(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(xs).sort();
  return n % 2 === 1
    ? sorted[(n - 1) >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function mean(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i];
  return s / n;
}

// =================================================================
// ComputeResult — directly translates the spec's pseudocode
// =================================================================

function computeResult(seq: BltSequence): void {
  if (seq.northDeltas.length < 3) return; // not enough data

  const m = mean(seq.northDeltas);
  const med = median(seq.northDeltas); // signed
  // sigma is computed in the original but unused in display; skip.

  seq.medianNorthMove = med;
  const totalNorth = m * seq.northDeltas.length;
  const expectedAmt = 0.9 * med; // signed threshold
  const expectedMagnitude = Math.abs(expectedAmt);
  seq.northRate = totalNorth !== 0
    ? (seq.northDeltas.length * seq.pulseSize) / totalNorth
    : 0; // ms/px

  let earlySouthMoves = 0;
  let lastSouthMove = 0;
  let goodSouthMoves = 0;

  for (let step = 0; step < seq.southDeltas.length; step++) {
    goodSouthMoves += 1; // optimistic; may decrement below
    earlySouthMoves += seq.southDeltas[step];

    const thisMove = seq.southDeltas[step];

    // Smoothing: if this move is small (below threshold), average with
    // previous. NOTE: spec preserves the original signed compare
    // (abs(thisMove) < expectedAmt) — DO NOT replace with magnitude.
    let smoothedMove: number;
    if (step !== 0 && Math.abs(thisMove) < expectedAmt) {
      smoothedMove = Math.max(Math.abs(thisMove), Math.abs((thisMove + lastSouthMove) / 2));
    } else {
      smoothedMove = thisMove;
    }

    lastSouthMove = thisMove;

    // "Good" = magnitude over threshold AND moving in the correct
    // (opposite-to-north) direction. The sign-product check enforces
    // that — don't drop the sign.
    if (Math.abs(smoothedMove) >= expectedMagnitude
        && (seq.southDeltas[step] * expectedAmt) < 0) {
      if (goodSouthMoves === 2) {
        seq.blPx = Math.max(0, (step + 1) * expectedMagnitude - Math.abs(earlySouthMoves));
        seq.blMs = seq.blPx * seq.northRate;
        seq.minSouthMoves = step;
        return;
      }
    } else {
      if (goodSouthMoves > 0) goodSouthMoves -= 1;
    }
  }
  // Loop finished without hitting goodSouthMoves==2: leave blPx/blMs at 0.
}

function newSequence(): BltSequence {
  return {
    timestamp: '',
    pulseSize: 0,
    northPoints: [],
    southPoints: [],
    northDeltas: [],
    southDeltas: [],
    medianNorthMove: 0,
    northRate: 0,
    minSouthMoves: 0,
    blPx: 0,
    blMs: 0,
  };
}

// =================================================================
// State machine — drives the per-line parsing within a sequence
// =================================================================

interface BltParseState {
  current: BltSequence | null;
  pulseSizeCaptured: boolean;
  /** Last DecLoc value seen — used to compute consecutive deltas. 0 means "fresh phase". */
  lastDecPos: number;
  /** Sequences finalized so far. */
  results: BltSequence[];
}

function processLine(state: BltParseState, line: string): void {
  // Cheap pre-filter (the caller usually does this too, but enforce
  // here for safety). Case-insensitive substring contains.
  const upper = line.toUpperCase();
  if (!upper.includes('BLT')) return;

  // ---- New test starts ----
  if (upper.includes('BLT STARTING NORTH BACKLASH')) {
    if (state.current) {
      // The previous sequence ended without an explicit BACKLASH
      // AMOUNT or PROCESS HALTED — finalize it now.
      computeResult(state.current);
      state.results.push(state.current);
    }
    state.current = newSequence();
    state.pulseSizeCaptured = false;
    state.lastDecPos = 0;
    // First 8 chars of the line are HH:mm:ss.
    state.current.timestamp = line.slice(0, 8);
    return;
  }

  if (!state.current) return; // pre-test BLT chatter; ignore

  // ---- Reset before north-move phase ----
  if (upper.includes('STARTING NORTH MOVES')) {
    state.current.northDeltas = [];
    state.current.northPoints = [];
    state.pulseSizeCaptured = false;
    state.lastDecPos = 0;
    return;
  }

  // ---- North move ----
  if (upper.includes('MOVING NORTH')) {
    // skipAmt = 3 because the literal text is "DecLoc = " — the helper
    // walks past the "= " so we pass skipAmt=3 to mirror the C# call.
    const decLoc = extractNumber(line, 'DecLoc', 3);
    if (Number.isFinite(decLoc)) {
      state.current.northPoints.push(decLoc);
      if (state.lastDecPos !== 0) {
        state.current.northDeltas.push(decLoc - state.lastDecPos);
      }
      state.lastDecPos = decLoc;
    }
    if (!state.pulseSizeCaptured) {
      const pulseMs = extractNumber(line, 'for', 1);
      if (Number.isFinite(pulseMs)) {
        state.current.pulseSize = pulseMs;
        state.pulseSizeCaptured = true;
      }
    }
    return;
  }

  // ---- End of north phase ----
  if (upper.includes('NORTH PULSES ENDED')) {
    const decLoc = extractNumber(line, 'location', 1);
    if (Number.isFinite(decLoc)) {
      state.current.northPoints.push(decLoc);
      if (state.lastDecPos !== 0) {
        state.current.northDeltas.push(decLoc - state.lastDecPos);
      }
      state.lastDecPos = 0; // reset for the south phase
    }
    return;
  }

  // ---- South move ----
  if (upper.includes('MOVING SOUTH')) {
    const decLoc = extractNumber(line, 'DecLoc', 3);
    if (Number.isFinite(decLoc)) {
      state.current.southPoints.push(decLoc);
      if (state.lastDecPos !== 0) {
        state.current.southDeltas.push(decLoc - state.lastDecPos);
      }
      state.lastDecPos = decLoc;
    }
    return;
  }

  // ---- End-of-test markers ----
  if (upper.includes('BACKLASH AMOUNT') || upper.includes('PROCESS HALTED')) {
    computeResult(state.current);
    state.results.push(state.current);
    state.current = null;
    state.pulseSizeCaptured = false;
    state.lastDecPos = 0;
    return;
  }
}

// =================================================================
// Public entry points
// =================================================================

/** Validate that the file's first line looks like a PHD2 DEBUG log header.
 *  Returns null if OK, or a localized-key-friendly error message. */
export function validateDebugLogHeader(firstLine: string): string | null {
  if (firstLine.includes('begins execution') || firstLine.includes('continues execution')) {
    return null;
  }
  return 'notDebugLog';
}

/** Parse the full text of a debug log into BltSequence[]. Suitable for
 *  off-thread use (no DOM access). For very large files (40+ MB), prefer
 *  the streaming variant below. */
export function parseBltText(text: string): BltSequence[] {
  // Split into lines without copying — readline-style iteration over
  // \n-delimited chunks. Real debug logs use Windows \r\n which we
  // strip when extracting fields.
  const state: BltParseState = {
    current: null,
    pulseSizeCaptured: false,
    lastDecPos: 0,
    results: [],
  };
  let i = 0;
  while (i < text.length) {
    const next = text.indexOf('\n', i);
    const end = next < 0 ? text.length : next;
    let line = text.slice(i, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    processLine(state, line);
    i = next < 0 ? text.length : next + 1;
  }
  // Finalize the last in-flight sequence (truncated log).
  if (state.current) {
    computeResult(state.current);
    state.results.push(state.current);
  }
  return state.results;
}

/** Streaming parser — feed chunks of text as they arrive, then call
 *  finalize() at end-of-file. Internally line-buffers across chunk
 *  boundaries so a line split between two reads is still correctly
 *  processed. Used by the web worker to avoid materializing 44 MB of
 *  text in memory at once. */
export class BltStreamParser {
  private state: BltParseState = {
    current: null,
    pulseSizeCaptured: false,
    lastDecPos: 0,
    results: [],
  };
  private buffer = '';

  /** Push another chunk of text (e.g. from TextDecoder.decode()).
   *  Lines that span chunk boundaries are buffered and processed when
   *  the next newline arrives. */
  push(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      processLine(this.state, line);
      this.buffer = this.buffer.slice(nl + 1);
    }
  }

  /** Process any leftover (no-trailing-newline) line and finalize an
   *  in-flight sequence. Returns the parsed sequence list. */
  finalize(): BltSequence[] {
    if (this.buffer.length > 0) {
      let line = this.buffer;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      processLine(this.state, line);
      this.buffer = '';
    }
    if (this.state.current) {
      computeResult(this.state.current);
      this.state.results.push(this.state.current);
      this.state.current = null;
    }
    return this.state.results;
  }
}

/** Convenience wrapper: read the full file as text, validate the header,
 *  and parse. Throws if the header check fails. Use this when the file
 *  is small enough to fit in memory comfortably; otherwise use the
 *  worker + BltStreamParser path. */
export async function parseDebugLogFile(file: File): Promise<BltSequence[]> {
  // Read just the first 200 chars to validate without slurping 44 MB
  // before we know the file is even a debug log.
  const headBlob = file.slice(0, 200);
  const head = await headBlob.text();
  const firstLine = head.split('\n')[0];
  const headerErr = validateDebugLogHeader(firstLine);
  if (headerErr) throw new Error(headerErr);
  const text = await file.text();
  return parseBltText(text);
}
