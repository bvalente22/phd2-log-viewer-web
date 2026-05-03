import { describe, it, expect } from 'vitest';
import { parseLogFilename } from '../filename';

describe('parseLogFilename', () => {
  it('parses a standard PHD2 guide-log filename', () => {
    const out = parseLogFilename('PHD2_GuideLog_2026-03-30_161541.txt');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    const d = new Date(out!.dateMs!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March is index 2
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(15);
    expect(out!.dateLabel).toBe('2026-03-30 · 16:15');
  });

  it('matches lowercase "guidelog" too', () => {
    const out = parseLogFilename('phd2_guidelog_2024-01-01_010101.log');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    expect(out!.dateLabel).toBe('2024-01-01 · 01:01');
  });

  it('returns null for filenames that do not contain "guidelog"', () => {
    expect(parseLogFilename('PHD2_DebugLog_2026-03-30_161541.txt')).toBeNull();
    expect(parseLogFilename('readme.md')).toBeNull();
    expect(parseLogFilename('PHD2_DebugLog_2026.txt')).toBeNull();
  });

  it('falls back to filename label when date pattern is missing', () => {
    const out = parseLogFilename('PHD2_GuideLog_renamed.txt');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    expect(out!.dateMs).toBeNull();
    expect(out!.dateLabel).toBe('PHD2_GuideLog_renamed.txt');
  });

  it('returns null when guidelog substring missing even with a date', () => {
    expect(parseLogFilename('Notes_2026-03-30_161541.txt')).toBeNull();
  });

  it('uses the first date+time match if there are several', () => {
    const out = parseLogFilename(
      'PHD2_GuideLog_2026-03-30_161541_then_2026-04-01_120000.txt',
    );
    expect(out!.dateLabel).toBe('2026-03-30 · 16:15');
  });

  it('treats a date without an HHMMSS suffix as unparseable', () => {
    const out = parseLogFilename('PHD2_GuideLog_2026-03-30.txt');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    expect(out!.dateMs).toBeNull();
    expect(out!.dateLabel).toBe('PHD2_GuideLog_2026-03-30.txt');
  });
});
