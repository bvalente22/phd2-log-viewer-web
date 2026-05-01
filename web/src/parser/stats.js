const linregSlope = (xs, ys) => {
    if (xs.length < 2)
        return 0;
    let mx = 0, my = 0;
    for (let i = 0; i < xs.length; i++) {
        mx += xs[i];
        my += ys[i];
    }
    mx /= xs.length;
    my /= ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx;
        num += dx * (ys[i] - my);
        den += dx * dx;
    }
    return den === 0 ? 0 : num / den;
};
const pcaEllipse = (ras, decs) => {
    const n = ras.length;
    if (n < 2)
        return { theta: 0, lx: 0, ly: 0, elongation: 1 };
    let mra = 0, mdec = 0;
    for (let i = 0; i < n; i++) {
        mra += ras[i];
        mdec += decs[i];
    }
    mra /= n;
    mdec /= n;
    let cxx = 0, cxy = 0, cyy = 0;
    for (let i = 0; i < n; i++) {
        const a = ras[i] - mra;
        const b = decs[i] - mdec;
        cxx += a * a;
        cxy += a * b;
        cyy += b * b;
    }
    cxx /= n;
    cxy /= n;
    cyy /= n;
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.max(0, tr * tr / 4 - det);
    const l1 = tr / 2 + Math.sqrt(disc);
    const l2 = tr / 2 - Math.sqrt(disc);
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const lx = Math.sqrt(Math.max(0, l1));
    const ly = Math.sqrt(Math.max(0, l2));
    const elongation = ly === 0 ? Infinity : lx / ly;
    return { theta, lx, ly, elongation };
};
export function calcStats(s, mask) {
    const ras = [];
    const decs = [];
    const dts = [];
    let included = 0;
    let excluded = 0;
    for (let i = 0; i < s.entries.length; i++) {
        const e = s.entries[i];
        const masked = mask && mask[i] === 1;
        if (!e.included || masked) {
            excluded++;
            continue;
        }
        included++;
        ras.push(e.raraw);
        decs.push(e.decraw);
        dts.push(e.dt);
    }
    const sumSq = (a) => a.reduce((x, y) => x + y * y, 0);
    const rmsRa = ras.length ? Math.sqrt(sumSq(ras) / ras.length) : 0;
    const rmsDec = decs.length ? Math.sqrt(sumSq(decs) / decs.length) : 0;
    const rmsTotal = Math.sqrt(rmsRa * rmsRa + rmsDec * rmsDec);
    const peakRa = ras.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const peakDec = decs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const meanRa = ras.length ? ras.reduce((a, b) => a + b, 0) / ras.length : 0;
    const meanDec = decs.length ? decs.reduce((a, b) => a + b, 0) / decs.length : 0;
    const driftRa = linregSlope(dts, ras) * 60;
    const driftDec = linregSlope(dts, decs) * 60;
    const ellipse = pcaEllipse(ras, decs);
    const driftDecArcsecMin = Math.abs(driftDec) * s.pixelScale;
    const cosDec = Math.cos(s.declination) || 1;
    const paeArcMin = (driftDecArcsecMin * 3.81972) / cosDec;
    return {
        rmsRa, rmsDec, rmsTotal,
        peakRa, peakDec,
        meanRa, meanDec,
        driftRa, driftDec,
        rmsRaArcsec: rmsRa * s.pixelScale,
        rmsDecArcsec: rmsDec * s.pixelScale,
        rmsTotalArcsec: rmsTotal * s.pixelScale,
        driftRaArcsec: driftRa * s.pixelScale,
        driftDecArcsec: driftDec * s.pixelScale,
        paeArcMin,
        ellipse,
        durationSec: s.duration,
        includedCount: included,
        excludedCount: excluded,
    };
}
