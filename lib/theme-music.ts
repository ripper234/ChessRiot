import type { ThemeId } from "./themes";

export type MusicStep = number | readonly number[] | null;
export type MusicPattern = readonly [
  MusicStep, MusicStep, MusicStep, MusicStep,
  MusicStep, MusicStep, MusicStep, MusicStep,
  MusicStep, MusicStep, MusicStep, MusicStep,
  MusicStep, MusicStep, MusicStep, MusicStep,
];
export type PercussionPattern = readonly [
  boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean,
];

export interface MusicVoiceProfile {
  wave: OscillatorType;
  pattern: MusicPattern;
  octave: number;
  level: number;
  gate: number;
  attack: number;
  filterHz: number;
  pan: number;
  detune?: number;
}

export interface MusicPercussionProfile {
  wave: OscillatorType;
  pattern: PercussionPattern;
  frequency: number;
  endFrequency: number;
  level: number;
  decay: number;
  pan: number;
}

export interface ThemeMusicProfile {
  bpm: number;
  swing: number;
  rootHz: number;
  lead: MusicVoiceProfile;
  bass: MusicVoiceProfile;
  harmony: MusicVoiceProfile;
  percussion: MusicPercussionProfile;
}

const R = null;
const X = true;
const O = false;

// These compact scores intentionally share no audio files. Each sixteen-step
// loop has its own rhythm, register, oscillator palette, voicing, and pulse so
// changing skins changes the musical character rather than merely transposing
// the same four notes.
export const THEME_MUSIC_PROFILES = {
  classic: {
    bpm: 88,
    swing: 0.04,
    rootHz: 220,
    lead: {
      wave: "triangle", octave: 0, level: 0.032, gate: 0.82, attack: 0.018,
      filterHz: 2_600, pan: 0.2,
      pattern: [0, R, 4, R, 7, R, 11, R, 9, R, 7, 4, 2, R, 4, R],
    },
    bass: {
      wave: "sine", octave: -1, level: 0.028, gate: 1.7, attack: 0.028,
      filterHz: 720, pan: -0.12,
      pattern: [0, R, R, R, 7, R, R, R, 5, R, R, R, 7, R, R, R],
    },
    harmony: {
      wave: "triangle", octave: -1, level: 0.013, gate: 3.4, attack: 0.09,
      filterHz: 1_500, pan: -0.28, detune: -4,
      pattern: [[0, 4, 7], R, R, R, R, R, R, R, [2, 5, 9], R, R, R, [0, 4, 7], R, R, R],
    },
    percussion: {
      wave: "sine", frequency: 86, endFrequency: 48, level: 0.018,
      decay: 0.12, pan: 0,
      pattern: [X, O, O, O, X, O, O, O, X, O, O, O, X, O, X, O],
    },
  },
  ocean: {
    bpm: 74,
    swing: 0.11,
    rootHz: 196,
    lead: {
      wave: "sine", octave: 0, level: 0.03, gate: 1.45, attack: 0.055,
      filterHz: 3_400, pan: 0.34,
      pattern: [0, R, 7, R, 12, R, 9, R, 5, R, 9, R, 7, R, 2, R],
    },
    bass: {
      wave: "triangle", octave: -1, level: 0.022, gate: 2.4, attack: 0.07,
      filterHz: 560, pan: -0.28,
      pattern: [0, R, R, R, R, R, 5, R, R, R, R, R, 7, R, R, R],
    },
    harmony: {
      wave: "sine", octave: -1, level: 0.012, gate: 5.2, attack: 0.24,
      filterHz: 1_100, pan: -0.38, detune: 5,
      pattern: [[0, 5, 9], R, R, R, R, R, R, R, [2, 7, 11], R, R, R, R, R, R, R],
    },
    percussion: {
      wave: "sine", frequency: 1_280, endFrequency: 610, level: 0.009,
      decay: 0.22, pan: 0.42,
      pattern: [O, O, X, O, O, O, O, X, O, X, O, O, O, O, X, O],
    },
  },
  blockfield: {
    bpm: 104,
    swing: 0.07,
    rootHz: 196,
    lead: {
      wave: "triangle", octave: 0, level: 0.031, gate: 0.62, attack: 0.008,
      filterHz: 2_100, pan: 0.26,
      pattern: [0, R, 3, 7, R, 10, R, 7, 5, R, 3, R, 0, 3, R, 7],
    },
    bass: {
      wave: "square", octave: -1, level: 0.018, gate: 0.72, attack: 0.006,
      filterHz: 520, pan: -0.24,
      pattern: [0, R, R, 0, R, 7, R, R, 5, R, R, 5, R, 7, R, R],
    },
    harmony: {
      wave: "sine", octave: -1, level: 0.011, gate: 2.6, attack: 0.13,
      filterHz: 1_250, pan: -0.08,
      pattern: [[0, 3, 7], R, R, R, [3, 7, 10], R, R, R, [0, 5, 10], R, R, R, [0, 3, 7], R, R, R],
    },
    percussion: {
      wave: "square", frequency: 118, endFrequency: 62, level: 0.014,
      decay: 0.075, pan: 0.08,
      pattern: [X, O, O, X, O, X, O, O, X, O, X, O, O, X, O, X],
    },
  },
  toybox: {
    bpm: 126,
    swing: 0.02,
    rootHz: 261.63,
    lead: {
      wave: "square", octave: 0, level: 0.019, gate: 0.42, attack: 0.004,
      filterHz: 2_800, pan: 0.38,
      pattern: [0, 4, 7, R, 12, 7, 4, R, 2, 5, 9, R, 7, 5, 2, R],
    },
    bass: {
      wave: "triangle", octave: -1, level: 0.023, gate: 0.58, attack: 0.004,
      filterHz: 680, pan: -0.36,
      pattern: [0, R, 0, R, 5, R, 5, R, 7, R, 7, R, 0, R, 7, R],
    },
    harmony: {
      wave: "square", octave: -1, level: 0.008, gate: 1.3, attack: 0.008,
      filterHz: 1_700, pan: -0.08, detune: 7,
      pattern: [[0, 4, 7], R, R, R, [5, 9, 12], R, R, R, [7, 11, 14], R, R, R, [0, 4, 7], R, R, R],
    },
    percussion: {
      wave: "triangle", frequency: 920, endFrequency: 1_360, level: 0.011,
      decay: 0.055, pan: 0.16,
      pattern: [X, O, X, O, X, X, O, X, X, O, X, O, X, O, X, X],
    },
  },
  "arena-pop": {
    bpm: 132,
    swing: 0.055,
    rootHz: 220,
    lead: {
      wave: "sawtooth", octave: 0, level: 0.017, gate: 0.5, attack: 0.005,
      filterHz: 2_400, pan: 0.31,
      pattern: [0, R, 7, 10, R, 12, 10, R, 3, R, 10, 7, R, 5, 3, R],
    },
    bass: {
      wave: "square", octave: -1, level: 0.022, gate: 0.48, attack: 0.004,
      filterHz: 460, pan: -0.31,
      pattern: [0, R, 0, 0, R, 5, R, 5, 3, R, 3, R, 7, R, 7, R],
    },
    harmony: {
      wave: "triangle", octave: -1, level: 0.011, gate: 1.65, attack: 0.025,
      filterHz: 1_600, pan: 0,
      pattern: [[0, 3, 7], R, R, R, R, R, [3, 7, 10], R, [5, 8, 12], R, R, R, [7, 10, 14], R, R, R],
    },
    percussion: {
      wave: "square", frequency: 154, endFrequency: 54, level: 0.018,
      decay: 0.07, pan: -0.05,
      pattern: [X, O, X, O, X, O, X, X, X, O, X, O, X, X, O, X],
    },
  },
  "high-fantasy": {
    bpm: 78,
    swing: 0.025,
    rootHz: 164.81,
    lead: {
      wave: "triangle", octave: 1, level: 0.027, gate: 1.15, attack: 0.025,
      filterHz: 2_500, pan: 0.32,
      pattern: [0, R, 2, 5, 7, R, 9, R, 12, R, 9, 7, 5, R, 2, R],
    },
    bass: {
      wave: "sine", octave: -1, level: 0.027, gate: 2.8, attack: 0.08,
      filterHz: 520, pan: -0.3,
      pattern: [0, R, R, R, 5, R, R, R, 2, R, R, R, 7, R, R, R],
    },
    harmony: {
      wave: "triangle", octave: -1, level: 0.012, gate: 4.3, attack: 0.16,
      filterHz: 1_050, pan: -0.12, detune: -7,
      pattern: [[0, 5, 9], R, R, R, R, R, R, R, [2, 7, 12], R, R, R, R, R, R, R],
    },
    percussion: {
      wave: "sine", frequency: 124, endFrequency: 72, level: 0.012,
      decay: 0.18, pan: 0.12,
      pattern: [X, O, O, O, O, O, X, O, X, O, O, O, O, X, O, O],
    },
  },
  "mythic-beasts": {
    bpm: 90,
    swing: 0.065,
    rootHz: 146.83,
    lead: {
      wave: "sawtooth", octave: 1, level: 0.016, gate: 0.9, attack: 0.016,
      filterHz: 1_850, pan: 0.34,
      pattern: [0, R, 7, R, 10, 12, R, 7, 5, R, 12, 10, 7, R, 3, R],
    },
    bass: {
      wave: "triangle", octave: -1, level: 0.03, gate: 1.55, attack: 0.025,
      filterHz: 430, pan: -0.34,
      pattern: [0, R, R, 0, R, 5, R, R, 3, R, R, 3, R, 7, R, R],
    },
    harmony: {
      wave: "sine", octave: 0, level: 0.012, gate: 3.2, attack: 0.12,
      filterHz: 1_300, pan: -0.08, detune: 6,
      pattern: [[0, 7, 10], R, R, R, [5, 10, 12], R, R, R, [3, 7, 12], R, R, R, [0, 7, 10], R, R, R],
    },
    percussion: {
      wave: "sawtooth", frequency: 102, endFrequency: 39, level: 0.014,
      decay: 0.16, pan: 0.04,
      pattern: [X, O, O, X, O, O, X, O, X, O, X, O, O, X, O, X],
    },
  },
  "arcane-cards": {
    bpm: 94,
    swing: 0.09,
    rootHz: 185,
    lead: {
      wave: "sine", octave: 1, level: 0.025, gate: 0.72, attack: 0.012,
      filterHz: 3_100, pan: 0.41,
      pattern: [0, 3, R, 8, 7, R, 3, R, 11, 8, R, 7, 3, R, 0, R],
    },
    bass: {
      wave: "sawtooth", octave: -1, level: 0.012, gate: 1.25, attack: 0.035,
      filterHz: 410, pan: -0.36,
      pattern: [0, R, R, 0, R, 8, R, R, 3, R, R, 3, R, 7, R, R],
    },
    harmony: {
      wave: "sine", octave: -1, level: 0.014, gate: 3.8, attack: 0.19,
      filterHz: 1_350, pan: -0.16, detune: 9,
      pattern: [[0, 3, 8], R, R, R, R, R, R, R, [3, 7, 11], R, R, R, [0, 3, 8], R, R, R],
    },
    percussion: {
      wave: "triangle", frequency: 680, endFrequency: 240, level: 0.008,
      decay: 0.13, pan: 0.22,
      pattern: [O, X, O, O, X, O, O, X, O, O, X, O, X, O, O, X],
    },
  },
  "iron-legions": {
    bpm: 86,
    swing: 0,
    rootHz: 110,
    lead: {
      wave: "square", octave: 1, level: 0.017, gate: 0.68, attack: 0.006,
      filterHz: 1_250, pan: 0.2,
      pattern: [0, R, 0, 3, 5, R, 3, R, 0, R, 7, 5, 3, R, 0, R],
    },
    bass: {
      wave: "square", octave: 0, level: 0.025, gate: 0.72, attack: 0.005,
      filterHz: 330, pan: -0.2,
      pattern: [0, R, 0, R, 5, R, 5, R, 3, R, 3, R, 0, R, 7, R],
    },
    harmony: {
      wave: "triangle", octave: 0, level: 0.011, gate: 2.1, attack: 0.04,
      filterHz: 930, pan: 0,
      pattern: [[0, 3, 7], R, R, R, [0, 5, 8], R, R, R, [0, 3, 7], R, R, R, [0, 3, 7], R, R, R],
    },
    percussion: {
      wave: "square", frequency: 78, endFrequency: 44, level: 0.022,
      decay: 0.11, pan: -0.04,
      pattern: [X, O, X, O, X, O, X, O, X, O, X, X, X, O, X, O],
    },
  },
  "shadow-shogun": {
    bpm: 70,
    swing: 0.14,
    rootHz: 146.83,
    lead: {
      wave: "sine", octave: 1, level: 0.027, gate: 0.74, attack: 0.015,
      filterHz: 2_900, pan: 0.38,
      pattern: [0, R, 2, R, 7, R, 9, R, 7, 2, R, 0, R, -3, R, 2],
    },
    bass: {
      wave: "triangle", octave: -1, level: 0.024, gate: 2.6, attack: 0.09,
      filterHz: 470, pan: -0.38,
      pattern: [0, R, R, R, R, R, 7, R, R, R, R, R, 2, R, R, R],
    },
    harmony: {
      wave: "sine", octave: 0, level: 0.01, gate: 4.8, attack: 0.3,
      filterHz: 1_000, pan: -0.18, detune: -9,
      pattern: [[0, 2, 7], R, R, R, R, R, R, R, [2, 7, 9], R, R, R, R, R, R, R],
    },
    percussion: {
      wave: "triangle", frequency: 1_460, endFrequency: 760, level: 0.006,
      decay: 0.19, pan: 0.45,
      pattern: [O, O, O, X, O, O, O, O, O, X, O, O, O, O, X, O],
    },
  },
  "neon-grid": {
    bpm: 138,
    swing: 0.035,
    rootHz: 220,
    lead: {
      wave: "sawtooth", octave: 0, level: 0.015, gate: 0.46, attack: 0.003,
      filterHz: 3_500, pan: 0.4,
      pattern: [0, 7, R, 10, 12, R, 15, 12, R, 10, 7, R, 3, 7, R, 10],
    },
    bass: {
      wave: "square", octave: -1, level: 0.023, gate: 0.82, attack: 0.004,
      filterHz: 570, pan: -0.4,
      pattern: [0, R, 0, R, 3, R, 3, R, 5, R, 5, R, 7, R, 10, R],
    },
    harmony: {
      wave: "sawtooth", octave: -1, level: 0.007, gate: 2.8, attack: 0.11,
      filterHz: 1_800, pan: -0.08, detune: 12,
      pattern: [[0, 3, 7], R, R, R, [3, 7, 10], R, R, R, [5, 10, 12], R, R, R, [7, 10, 15], R, R, R],
    },
    percussion: {
      wave: "square", frequency: 172, endFrequency: 58, level: 0.016,
      decay: 0.06, pan: 0.08,
      pattern: [X, O, X, X, X, O, X, O, X, X, X, O, X, O, X, X],
    },
  },
  mono: {
    bpm: 64,
    swing: 0,
    rootHz: 196,
    lead: {
      wave: "sine", octave: 0, level: 0.028, gate: 1.9, attack: 0.08,
      filterHz: 2_200, pan: 0.22,
      pattern: [0, R, R, R, 7, R, R, R, 12, R, R, R, 7, R, R, R],
    },
    bass: {
      wave: "sine", octave: -1, level: 0.02, gate: 3.3, attack: 0.18,
      filterHz: 430, pan: -0.22,
      pattern: [0, R, R, R, R, R, R, R, 5, R, R, R, R, R, R, R],
    },
    harmony: {
      wave: "sine", octave: 0, level: 0.009, gate: 5.6, attack: 0.4,
      filterHz: 980, pan: 0, detune: 3,
      pattern: [[0, 7], R, R, R, R, R, R, R, [5, 12], R, R, R, R, R, R, R],
    },
    percussion: {
      wave: "sine", frequency: 440, endFrequency: 438, level: 0.004,
      decay: 0.07, pan: 0,
      pattern: [X, O, O, O, O, O, O, O, X, O, O, O, O, O, O, O],
    },
  },
} as const satisfies Record<ThemeId, ThemeMusicProfile>;

