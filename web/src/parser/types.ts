export type WhichMount = 'MOUNT' | 'AO';

export interface GuideEntry {
  frame: number;
  dt: number;
  mount: WhichMount;
  included: boolean;
  guiding: boolean;
  dx: number;
  dy: number;
  raraw: number;
  decraw: number;
  raguide: number;
  decguide: number;
  radur: number;
  decdur: number;
  mass: number;
  snr: number;
  err: number;
  info: string;
}

export interface InfoEntry {
  idx: number;
  repeats: number;
  info: string;
}

export type CalDirection = 'WEST' | 'EAST' | 'BACKLASH' | 'NORTH' | 'SOUTH';

export interface CalibrationEntry {
  direction: CalDirection;
  step: number;
  dx: number;
  dy: number;
}

export interface Limits {
  minMo: number;
  maxDur: number;
}

export interface Mount {
  isValid: boolean;
  xRate: number;
  yRate: number;
  xAngle: number;
  yAngle: number;
  xlim: Limits;
  ylim: Limits;
}

export const newMount = (): Mount => ({
  isValid: false,
  xRate: 1.0,
  yRate: 1.0,
  xAngle: 0.0,
  yAngle: Math.PI / 2,
  xlim: { minMo: 0, maxDur: 0 },
  ylim: { minMo: 0, maxDur: 0 },
});

export interface GuideSession {
  date: string;
  startsMs: number | null;
  hdr: string[];
  duration: number;
  pixelScale: number;
  declination: number;
  hourAngleHours: number | null;
  pierSide: string | null;
  entries: GuideEntry[];
  infos: InfoEntry[];
  ao: Mount;
  mount: Mount;
}

export const newGuideSession = (date: string): GuideSession => ({
  date,
  startsMs: null,
  hdr: [],
  duration: 0,
  pixelScale: 1,
  declination: 0,
  hourAngleHours: null,
  pierSide: null,
  entries: [],
  infos: [],
  ao: newMount(),
  mount: newMount(),
});

export interface Calibration {
  date: string;
  startsMs: number | null;
  hdr: string[];
  device: WhichMount;
  entries: CalibrationEntry[];
}

export const newCalibration = (date: string): Calibration => ({
  date,
  startsMs: null,
  hdr: [],
  device: 'MOUNT',
  entries: [],
});

export type SectionType = 'CALIBRATION' | 'GUIDING';

export interface LogSectionLoc {
  type: SectionType;
  idx: number;
}

export interface GuideLog {
  phdVersion: string;
  sessions: GuideSession[];
  calibrations: Calibration[];
  sections: LogSectionLoc[];
}

export const newGuideLog = (): GuideLog => ({
  phdVersion: '',
  sessions: [],
  calibrations: [],
  sections: [],
});
