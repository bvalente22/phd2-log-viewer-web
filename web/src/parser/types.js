export const newMount = () => ({
    isValid: false,
    xRate: 1.0,
    yRate: 1.0,
    xAngle: 0.0,
    yAngle: Math.PI / 2,
    xlim: { minMo: 0, maxDur: 0 },
    ylim: { minMo: 0, maxDur: 0 },
});
export const newGuideSession = (date) => ({
    date,
    startsMs: null,
    hdr: [],
    duration: 0,
    pixelScale: 1,
    declination: 0,
    entries: [],
    infos: [],
    ao: newMount(),
    mount: newMount(),
});
export const newCalibration = (date) => ({
    date,
    startsMs: null,
    hdr: [],
    device: 'MOUNT',
    entries: [],
});
export const newGuideLog = () => ({
    phdVersion: '',
    sessions: [],
    calibrations: [],
    sections: [],
});
