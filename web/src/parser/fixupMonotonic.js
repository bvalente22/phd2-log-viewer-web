const isMonotonic = (s) => {
    for (let i = 1; i < s.entries.length; i++) {
        if (s.entries[i].dt <= s.entries[i - 1].dt)
            return false;
    }
    return true;
};
const insertInfo = (s, entryIdx, info) => {
    let pos = 0;
    while (pos < s.infos.length) {
        if (s.entries[s.infos[pos].idx].frame >= s.entries[entryIdx].frame)
            break;
        pos++;
    }
    const ie = { idx: entryIdx, repeats: 1, info };
    s.infos.splice(pos, 0, ie);
};
export function fixupNonMonotonic(s) {
    if (s.entries.length <= 1 || isMonotonic(s))
        return;
    const positives = [];
    for (let i = 1; i < s.entries.length; i++) {
        const d = s.entries[i].dt - s.entries[i - 1].dt;
        if (d > 0)
            positives.push(d);
    }
    if (positives.length === 0)
        return;
    positives.sort((a, b) => a - b);
    const med = positives[Math.floor(positives.length / 2)];
    let corr = 0;
    for (let i = 1; i < s.entries.length; i++) {
        const d = s.entries[i].dt + corr - s.entries[i - 1].dt;
        if (d <= 0) {
            corr += med - d;
            insertInfo(s, i, 'Timestamp jumped backwards');
        }
        s.entries[i].dt += corr;
    }
}
