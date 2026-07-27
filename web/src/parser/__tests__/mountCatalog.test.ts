import { describe, it, expect } from 'vitest';
import {
  parseMountCatalog, groupByManufacturer, MOUNT_CATALOG,
} from '../mountCatalog';

const HEADER = 'Manufacturer\tModel\tworm period (in seconds)';

describe('parseMountCatalog', () => {
  it('parses rows and drops the header', () => {
    const out = parseMountCatalog(`${HEADER}\nCelestron\tCGEM\t478.69\nLosmandy\tG11\t240.00`);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      manufacturer: 'Celestron', model: 'CGEM', wormPeriodSec: 478.69, key: 'Celestron CGEM',
    });
    expect(out[1].wormPeriodSec).toBe(240);
  });

  it('detects the header by its unparseable period, not by its text', () => {
    // The header wording may change; the parser must not depend on it.
    const out = parseMountCatalog('Make\tName\tSeconds\nCelestron\tCGEM\t478.69');
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe('CGEM');
  });

  it('tolerates blank lines, comments, CRLF and a BOM', () => {
    const text = '﻿' + [HEADER, '', '# a note', 'Celestron\tCGEM\t478.69', '   ', 'Losmandy\tG11\t240'].join('\r\n');
    const out = parseMountCatalog(text);
    expect(out.map((m) => m.model)).toEqual(['CGEM', 'G11']);
  });

  it('skips malformed rows without discarding the good ones', () => {
    const out = parseMountCatalog([
      HEADER,
      'OnlyTwo\tColumns',            // too few columns
      'Celestron\t\t478.69',          // missing model
      '\tCGEM\t478.69',               // missing manufacturer
      'Bad\tPeriod\tnot-a-number',    // unparseable
      'Zero\tPeriod\t0',              // non-positive
      'Neg\tPeriod\t-5',              // negative
      'Good\tMount\t384.00',          // the only valid row
    ].join('\n'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ manufacturer: 'Good', model: 'Mount', wormPeriodSec: 384 });
  });

  it('trims whitespace, accepts a comma decimal and extra trailing columns', () => {
    const out = parseMountCatalog(`${HEADER}\n  Sky-Watcher \t EQ6-R Pro \t478,69\textra\tcols`);
    expect(out[0]).toMatchObject({
      manufacturer: 'Sky-Watcher', model: 'EQ6-R Pro', wormPeriodSec: 478.69,
    });
  });

  it('rounds the period to 2dp', () => {
    expect(parseMountCatalog(`${HEADER}\nA\tB\t123.4567`)[0].wormPeriodSec).toBe(123.46);
  });

  it('keeps the first of a duplicate manufacturer+model', () => {
    const out = parseMountCatalog(`${HEADER}\nA\tB\t100\nA\tB\t200`);
    expect(out).toHaveLength(1);
    expect(out[0].wormPeriodSec).toBe(100);
  });

  it('sorts by manufacturer then model', () => {
    const out = parseMountCatalog([
      HEADER, 'Zeta\tM1\t100', 'Alpha\tZ9\t100', 'Alpha\tA1\t100',
    ].join('\n'));
    expect(out.map((m) => m.key)).toEqual(['Alpha A1', 'Alpha Z9', 'Zeta M1']);
  });

  it('returns an empty catalog for empty or header-only input', () => {
    expect(parseMountCatalog('')).toEqual([]);
    expect(parseMountCatalog(HEADER)).toEqual([]);
  });
});

describe('groupByManufacturer', () => {
  it('groups consecutive entries and preserves order', () => {
    const groups = groupByManufacturer(parseMountCatalog([
      HEADER, 'Alpha\tA1\t100', 'Alpha\tA2\t100', 'Beta\tB1\t100',
    ].join('\n')));
    expect(groups.map((g) => g.manufacturer)).toEqual(['Alpha', 'Beta']);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].entries).toHaveLength(1);
  });

  it('handles an empty catalog', () => {
    expect(groupByManufacturer([])).toEqual([]);
  });
});

describe('the real catalog file', () => {
  // SHAPE ONLY. The .tsv is maintained out-of-band and updated periodically, so
  // asserting specific manufacturers, models, periods or counts would turn a
  // routine data refresh into a failing build. Assert only what must always
  // hold, however the data changes.
  it('loads and is non-empty', () => {
    expect(MOUNT_CATALOG.length).toBeGreaterThan(0);
  });

  it('every entry is well-formed', () => {
    for (const m of MOUNT_CATALOG) {
      expect(m.manufacturer.length).toBeGreaterThan(0);
      expect(m.model.length).toBeGreaterThan(0);
      expect(Number.isFinite(m.wormPeriodSec)).toBe(true);
      expect(m.wormPeriodSec).toBeGreaterThan(0);
      expect(m.key).toBe(`${m.manufacturer} ${m.model}`);
    }
  });

  it('has unique keys', () => {
    expect(new Set(MOUNT_CATALOG.map((m) => m.key)).size).toBe(MOUNT_CATALOG.length);
  });
});
