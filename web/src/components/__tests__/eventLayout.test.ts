import { describe, it, expect } from 'vitest';
import { layoutInlineEvents } from '../eventLayout';

// Fixed-width measurer: every character is 6 px wide. Keeps the assertions
// deterministic regardless of how the runtime canvas API would behave.
const fixedWidth = (text: string) => text.length * 6;

describe('layoutInlineEvents', () => {
  it('returns [] for empty input', () => {
    expect(layoutInlineEvents([], 1, fixedWidth)).toEqual([]);
  });

  it('places a single event on row 0', () => {
    const out = layoutInlineEvents(
      [{ timeSec: 0, text: 'A', isDither: false }],
      1,
      fixedWidth,
    );
    expect(out).toHaveLength(1);
    expect(out[0].row).toBe(0);
  });

  it('keeps two well-separated events on row 0', () => {
    // event A: t=0, "A" (6 px wide). event B: t=100s, "B" (6 px). At
    // pxPerSecond=1 the second sits at xpos=100, far past A_end+10=16.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'A', isDither: false },
        { timeSec: 100, text: 'B', isDither: false },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 0]);
  });

  it('promotes the second of two overlapping events to row 1', () => {
    // event A: t=0, "AAAAA" (30 px). event B: t=1s. xpos_B=1 < 30+10=40 → row=1.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'AAAAA', isDither: false },
        { timeSec: 1, text: 'BBBBB', isDither: true },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1]);
  });

  it('stacks three progressively closer events as 0, 1, 2', () => {
    // A at t=0 ("AAAAA" 30px). B at t=1s overlaps → row 1, prev_end=36.
    // C at t=2s, xpos=2 < 36+10=46 → row=2.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'AAAAA', isDither: false },
        { timeSec: 1, text: 'BBBBB', isDither: false },
        { timeSec: 2, text: 'CCCCC', isDither: false },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1, 2]);
  });

  it('zooming in (more px per second) breaks an overlap apart', () => {
    // Same input as the overlap test, but pxPerSecond=100. xpos_B=100 >> 30+10.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'AAAAA', isDither: false },
        { timeSec: 1, text: 'BBBBB', isDither: true },
      ],
      100,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 0]);
  });

  it('zooming out (fewer px per second) creates an overlap', () => {
    // Two events 200s apart, narrow text. At pxPerSecond=0.05 they sit at
    // xpos=0 and xpos=10 px. With width 6 px and gap 10 px → second is at 10
    // which is NOT < prev_end(6)+10 = 16... we need them closer. Use
    // pxPerSecond=0.02: xpos_B = 4. 4 < 16 → row 1.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'A', isDither: false },
        { timeSec: 200, text: 'B', isDither: false },
      ],
      0.02,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1]);
  });

  it('preserves the input text and isDither flag verbatim', () => {
    const out = layoutInlineEvents(
      [
        { timeSec: 5, text: 'DITHER 0.5, 0.5 ×3', isDither: true },
      ],
      1,
      fixedWidth,
    );
    expect(out[0].text).toBe('DITHER 0.5, 0.5 ×3');
    expect(out[0].isDither).toBe(true);
    expect(out[0].timeSec).toBe(5);
  });

  it('sorts unsorted input ascending before laying out', () => {
    // Caller may pass already-sorted infos, but the helper guards against
    // reordering. With pxPerSecond=1, A@0 and C@100 are far apart; if the
    // helper sorts, both rows = 0. If it didn't, the t=100 → t=0 jump would
    // produce nonsense rows.
    const out = layoutInlineEvents(
      [
        { timeSec: 100, text: 'C', isDither: false },
        { timeSec: 0, text: 'A', isDither: false },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.timeSec)).toEqual([0, 100]);
    expect(out.map((o) => o.row)).toEqual([0, 0]);
  });

  it('reuses a freed lower row instead of cascading upward', () => {
    // A is a wide label spanning 0–204 px on row 0. B and C cluster right
    // after it (rows 1 and 2). D starts at x=20 — still under A (row 0 is
    // taken) but well past B's right edge (7 px) + the 10 px gap, so it
    // belongs back on row 1, not stacked up to a needless row 3.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'A'.repeat(34), isDither: false }, // 204 px
        { timeSec: 1, text: 'B', isDither: false }, //            row 1 (under A)
        { timeSec: 2, text: 'C', isDither: false }, //            row 2 (under A, beside B)
        { timeSec: 20, text: 'D', isDither: false }, //           row 1 (B's row has freed)
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1, 2, 1]);
  });

  it('never overlaps two labels placed on the same row', () => {
    const pps = 1;
    const events = [
      { timeSec: 0, text: 'AAAAAAAAAA', isDither: false }, // 60 px, row 0
      { timeSec: 2, text: 'BBBB', isDither: false },
      { timeSec: 5, text: 'CCCCCC', isDither: true },
      { timeSec: 8, text: 'DD', isDither: false },
      { timeSec: 65, text: 'EEEEEEEE', isDither: false },
      { timeSec: 70, text: 'F', isDither: false },
      { timeSec: 72, text: 'GGGG', isDither: true },
    ];
    const out = layoutInlineEvents(events, pps, fixedWidth);
    const byRow = new Map<number, typeof out>();
    for (const o of out) {
      const arr = byRow.get(o.row) ?? [];
      arr.push(o);
      byRow.set(o.row, arr);
    }
    for (const items of byRow.values()) {
      items.sort((a, b) => a.timeSec - b.timeSec);
      for (let i = 1; i < items.length; i++) {
        const prevRight = items[i - 1].timeSec * pps + fixedWidth(items[i - 1].text);
        const curLeft = items[i].timeSec * pps;
        // Same-row labels must never overlap: each one's left edge starts at
        // or after the previous label's right edge on that row.
        expect(curLeft).toBeGreaterThanOrEqual(prevRight);
      }
    }
  });
});
