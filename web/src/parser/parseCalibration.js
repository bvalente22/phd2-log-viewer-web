const DIRS = {
    West: 'WEST',
    Left: 'WEST',
    East: 'EAST',
    Backlash: 'BACKLASH',
    North: 'NORTH',
    Up: 'NORTH',
    South: 'SOUTH',
};
export function isAoDirectionToken(tok) {
    return tok === 'Left' || tok === 'Up';
}
export function parseCalibration(ln) {
    const cols = ln.split(',');
    if (cols.length < 4)
        return null;
    const direction = DIRS[cols[0]];
    if (!direction)
        return null;
    const step = parseInt(cols[1], 10);
    const dx = parseFloat(cols[2]);
    const dy = parseFloat(cols[3]);
    if (![step, dx, dy].every(Number.isFinite))
        return null;
    return { direction, step, dx, dy };
}
