# BLT (Backlash Test) Analysis — Portable Spec

Ported from the original C# WinForms `BLTAnalyzer` (z:\HomeLab-Repos\PHDBacklashAnalyzer\BLTAnalyzer\). This document is language- and platform-agnostic — implement it in whatever stack PHDLogViewer uses.

## Purpose

Given a PHD2 auto-guider DEBUG log, find every Dec-axis Backlash Test sequence, parse the per-pulse Dec positions, and compute a backlash estimate in **pixels** and **milliseconds**, plus a few derived diagnostics.

## Input file

A PHD2 DEBUG log — plain UTF-8 text, one event per line. Each relevant line begins with an `HH:mm:ss` timestamp.

**Header validation:** The first line of the file must contain either `"begins execution"` or `"continues execution"`. Otherwise reject the file as "not a DEBUG log".

## Parsing model

Stream the file line-by-line. **Only lines containing the substring `"BLT"` are interesting** — everything else is ignored. A new test starts whenever a line contains `"BLT STARTING NORTH BACKLASH "` (case-insensitive); finalize the previous test (if any) and begin a fresh one.

Within a test, run a substring-match state machine. Matches are case-insensitive. Numeric extraction = "find this token, skip N characters, take the next whitespace/comma-delimited word, parse as double":

| Substring (uppercased) match | Extract | What to do |
|---|---|---|
| `BLT STARTING NORTH BACKLASH` | `HH:mm:ss` from line[0..8] | Set sequence timestamp |
| `STARTING NORTH MOVES` | — | Reset deltas, points, pulseSize=0, lastDecPos=0 |
| `MOVING NORTH` | `DecLoc <val>` (skip 3 chars after `DecLoc`); first hit also `for <ms>` (skip 1 char) | Append val to `northPoints`; if `lastDecPos != 0` push (val − lastDecPos) into `northDeltas`; `lastDecPos = val`; first time only, set `pulseSize` from `for` |
| `NORTH PULSES ENDED` | `location <val>` (skip 1) | Append to `northPoints`, push final delta, then `lastDecPos = 0` |
| `MOVING SOUTH` | `DecLoc <val>` (skip 3) | Append to `southPoints`, push delta to `southDeltas`, update `lastDecPos` |
| `BACKLASH AMOUNT` **or** `PROCESS HALTED` | — | Run `ComputeResult` on this sequence |

**Note on `skipAmt`:** the values 1 and 3 reflect the literal punctuation/whitespace after each token in PHD2's log format (e.g., `DecLoc = ` vs. `for `). Match what the original does — don't replace with a stricter parser unless you've confirmed PHD2 keeps the format stable.

## Required state per sequence

```
timestamp:        DateTime
pulseSize:        int       // ms per north guide pulse, captured from first MOVING NORTH
northPoints:      double[]  // raw Dec positions during north phase
southPoints:      double[]  // raw Dec positions during south phase
northDeltas:      double[]  // consecutive differences in northPoints
southDeltas:      double[]  // consecutive differences in southPoints

// computed by ComputeResult:
medianNorthMove:  double    // median of northDeltas
northRate:        double    // ms per pixel (guide rate)
minSouthMoves:    int       // south pulses needed to clear backlash
blPx:             double    // backlash in pixels
blMs:             double    // backlash in milliseconds
```

## Algorithm: ComputeResult

```
if northDeltas.length < 3: return  // not enough data

mean   = mean(northDeltas)
median = median(northDeltas)       // signed
sigma  = stddev(northDeltas)       // computed but not currently used in output

medianNorthMove   = median
totalNorth        = mean * northDeltas.length
expectedAmt       = 0.9 * medianNorthMove        // signed threshold
expectedMagnitude = abs(expectedAmt)
northRate         = (northDeltas.length * pulseSize) / totalNorth   // ms/px

earlySouthMoves = 0
lastSouthMove   = 0
goodSouthMoves  = 0
stepsNeeded     = 0

for step in 0 .. southDeltas.length - 1:
    goodSouthMoves += 1                    // optimistic; may be decremented below
    stepsNeeded   += 1
    earlySouthMoves += southDeltas[step]

    thisMove = southDeltas[step]

    // Smooth: if this move is small (below threshold), average with previous
    if step != 0 and abs(thisMove) < expectedAmt:    // NOTE: signed compare in original
        smoothedMove = max(abs(thisMove), abs((thisMove + lastSouthMove) / 2))
    else:
        smoothedMove = thisMove

    lastSouthMove = thisMove

    // "Good" = magnitude over threshold AND moving in the correct (opposite) direction
    if abs(smoothedMove) >= expectedMagnitude and (southDeltas[step] * expectedAmt) < 0:
        if goodSouthMoves == 2:
            blPx = max(0, (step + 1) * expectedMagnitude - abs(earlySouthMoves))
            blMs = blPx * northRate
            minSouthMoves = step
            break
    else:
        if goodSouthMoves > 0: goodSouthMoves -= 1
```

**Direction check gotcha:** `southDeltas[step] * expectedAmt < 0` requires opposite signs — i.e. real south motion vs. the (positive-north) median. Don't drop the sign.

**Smoothing compare gotcha:** the original compares `abs(thisMove) < expectedAmt` (signed `expectedAmt`, abs of move). Since `expectedAmt` is normally positive (median north step is positive), this is effectively the same as comparing against `expectedMagnitude`. If you ever encounter a log where the median north step is negative, this branch behaves oddly — preserve the original behavior unless you have a reason to "fix" it.

If the loop finishes without ever hitting the `goodSouthMoves == 2` branch, leave `blPx = blMs = 0`.

## Derived display fields (formatting)

These are what the original surfaces in its results grid. Reproduce verbatim if you want output parity:

| Field | Format | Source |
|---|---|---|
| TimeStamp | `HH:mm:ss` | sequence timestamp |
| PulseSize | `"{pulseSize} ms"` | int |
| South_Clearing | `"{minSouthMoves} steps"` | int |
| North_Rate | if `northRate > 0`: `"{1000/northRate:0.00} px/s"` else `"0"` | reciprocal — note the units flip from ms/px to px/s |
| South_Step_Goal | `"{0.9 * medianNorthMove:0.0} px"` | signed |
| Bl_Px | `"{blPx:0.0} px"` | |
| Bl_Ms | `"{blMs:0.0} ms"` | |

## Visualization

Per selected sequence, plot Dec offset vs. step index:
- X axis: 1..(northPoints.length + southPoints.length)
- North samples: red, connected dots, X = 1..northCount
- South samples: green, connected dots, X = northCount..(northCount + southCount − 1)
- Y axis: min/max of all combined points, with `+2` headroom on top
- Pan + zoom on both axes is expected

## Edge cases / behaviors to preserve

- A log with no `"BLT STARTING NORTH BACKLASH"` lines yields zero sequences — show "Log file doesn't contain a backlash test".
- A test that ends abruptly (`PROCESS HALTED`) still computes a result with whatever data was collected.
- `northDeltas` and `southDeltas` are **cleared at the end of `ComputeResult`** — `northPoints`/`southPoints` are kept for graphing. If your port wants to recompute later or use deltas elsewhere, don't clear.
- Stats (mean/median/stddev) come from a tiny home-grown library (`BasicStats.Sample`); any standard implementation works. Median uses standard sort-and-pick (interpolated for even-length arrays, but the original library's exact tie-break is not load-bearing for the algorithm).
- `northRate` can be 0 or negative if the log is malformed — guard the px/s display.

## Reference implementation

Original source files in the BLTAnalyzer repo:
- `BLTSequence.cs` — state machine + algorithm (`ProcessEvent`, `ComputeResult`)
- `Form1.cs` — file ingestion (`ProcessFile`) and ZedGraph rendering (`GraphResults`)
