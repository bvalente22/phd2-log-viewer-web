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
});
