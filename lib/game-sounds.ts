import { Chess } from "chess.js";
import type { GameSnapshot, PublicMove } from "./game-types";
import { DEFAULT_THEME, normalizeTheme, type ThemeId } from "./themes";

export type GameSound = "move" | "capture" | "check" | "castle" | "queen_capture" | "promotion_q" | "promotion_r" | "promotion_b" | "promotion_n" | "victory" | "defeat" | "draw" | "invalid";

const SOUND_PREFERENCE_KEY = "chessriot:sound";
const MUSIC_PREFERENCE_KEY = "chessriot:music";
const MASTER_VOLUME_KEY = "chessriot:master-volume";
export const AUDIO_PREFERENCES_EVENT = "chessriot:audio-preferences";
export interface AudioPreferences {
  effectsOn: boolean;
  musicOn: boolean;
  masterVolume: number;
}
type AudioContextConstructor = typeof AudioContext;
let audioContext: AudioContext | null = null;

export function readSoundPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SOUND_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSoundPreference(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // Sound still works for the current page when browser storage is unavailable.
  }
}

export function readMusicPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(MUSIC_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeMusicPreference(enabled: boolean): void {
  try {
    localStorage.setItem(MUSIC_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // Music still works for the current page when storage is unavailable.
  }
}

export function readMasterVolume(): number {
  if (typeof window === "undefined") return 0.45;
  try {
    const raw = localStorage.getItem(MASTER_VOLUME_KEY);
    if (raw === null) return 0.45;
    const stored = Number(raw);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.45;
  } catch {
    return 0.45;
  }
}

export function writeMasterVolume(volume: number): void {
  try {
    localStorage.setItem(MASTER_VOLUME_KEY, String(Math.max(0, Math.min(1, volume))));
  } catch {
    // The current tab still uses the selected volume.
  }
}

function capturedQueen(move: PublicMove, fallbackFen: string): boolean {
  try {
    const chess = new Chess(move.fenBefore ?? fallbackFen);
    const first = chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
    if (first.captured === "q") return true;
    if (!move.second) return false;
    const fields = chess.fen().split(" ");
    fields[1] = move.color;
    const second = new Chess(fields.join(" ")).move({
      from: move.second.from,
      to: move.second.to,
    });
    return second.captured === "q";
  } catch {
    return false;
  }
}

export function classifyGameSounds(previous: GameSnapshot | null, next: GameSnapshot): GameSound[] {
  if (!previous || next.version <= previous.version) return [];
  const sounds: GameSound[] = [];
  let fallbackFen = previous.fen;
  const newMoves = next.moves.filter((candidate) => candidate.ply > previous.plyCount);
  for (const [index, move] of newMoves.entries()) {
    const special: GameSound[] = [];
    if (move.promotion) special.push(`promotion_${move.promotion}` as GameSound);
    if (capturedQueen(move, fallbackFen)) special.push("queen_capture");
    if (move.san.startsWith("O-O") || move.second?.san.startsWith("O-O")) {
      special.push("castle");
    }
    if (
      move.san.includes("+")
      || move.san.includes("#")
      || move.second?.san.includes("+")
      || move.second?.san.includes("#")
      || (index === newMoves.length - 1 && next.check)
    ) {
      special.push("check");
    }
    sounds.push(...(special.length
      ? special
      : [move.san.includes("x") || move.second?.san.includes("x") ? "capture" : "move"] as GameSound[]));
    fallbackFen = move.fenAfter ?? fallbackFen;
  }

  if (previous.status !== "completed" && next.status === "completed" && next.outcome) {
    sounds.push(next.outcome.winner === null
      ? "draw"
      : next.outcome.winner === next.you.color ? "victory" : "defeat");
  }
  return sounds;
}

export function classifyGameSound(previous: GameSnapshot | null, next: GameSnapshot): GameSound | null {
  return classifyGameSounds(previous, next).at(-1) ?? null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const AudioContextClass = (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  );
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

export async function unlockGameSounds(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") await context.resume();
  return context.state === "running";
}

interface Tone {
  frequency: number;
  endFrequency?: number;
  delay?: number;
  duration: number;
  volume: number;
  type: OscillatorType;
}

function tone(context: AudioContext, sound: Tone): void {
  const start = context.currentTime + (sound.delay ?? 0);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = sound.type;
  oscillator.frequency.setValueAtTime(sound.frequency, start);
  if (sound.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(sound.endFrequency, start + sound.duration);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(sound.volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + sound.duration + 0.02);
}

const SOUND_TONES: Record<GameSound, Tone[]> = {
  move: [
    { frequency: 210, endFrequency: 150, duration: 0.075, volume: 0.055, type: "square" },
    { frequency: 680, duration: 0.035, volume: 0.025, type: "sine", delay: 0.025 },
  ],
  capture: [
    { frequency: 125, endFrequency: 62, duration: 0.16, volume: 0.08, type: "square" },
    { frequency: 520, endFrequency: 210, duration: 0.105, volume: 0.045, type: "sawtooth" },
  ],
  check: [
    { frequency: 440, duration: 0.09, volume: 0.045, type: "square" },
    { frequency: 660, duration: 0.11, volume: 0.045, type: "square", delay: 0.08 },
    { frequency: 880, duration: 0.14, volume: 0.04, type: "square", delay: 0.17 },
  ],
  castle: [
    { frequency: 92, endFrequency: 72, duration: 0.22, volume: 0.07, type: "square" },
    { frequency: 184, duration: 0.16, volume: 0.045, type: "triangle", delay: 0.1 },
    { frequency: 276, duration: 0.2, volume: 0.04, type: "triangle", delay: 0.19 },
  ],
  queen_capture: [
    { frequency: 740, endFrequency: 185, duration: 0.34, volume: 0.065, type: "sawtooth" },
    { frequency: 370, endFrequency: 92, duration: 0.4, volume: 0.055, type: "triangle", delay: 0.08 },
    { frequency: 55, duration: 0.28, volume: 0.07, type: "square", delay: 0.19 },
  ],
  promotion_q: [
    { frequency: 392, duration: .18, volume: .05, type: "triangle" },
    { frequency: 523.25, duration: .22, volume: .055, type: "triangle", delay: .12 },
    { frequency: 783.99, duration: .38, volume: .06, type: "triangle", delay: .25 },
  ],
  promotion_r: [
    { frequency: 130.81, duration: .18, volume: .06, type: "square" },
    { frequency: 261.63, duration: .22, volume: .05, type: "square", delay: .14 },
    { frequency: 392, duration: .32, volume: .05, type: "triangle", delay: .28 },
  ],
  promotion_b: [
    { frequency: 329.63, duration: .22, volume: .045, type: "sine" },
    { frequency: 493.88, duration: .24, volume: .05, type: "sine", delay: .13 },
    { frequency: 659.25, duration: .34, volume: .05, type: "sine", delay: .27 },
  ],
  promotion_n: [
    { frequency: 293.66, duration: .12, volume: .055, type: "triangle" },
    { frequency: 440, duration: .12, volume: .055, type: "triangle", delay: .09 },
    { frequency: 587.33, duration: .28, volume: .05, type: "triangle", delay: .2 },
  ],
  victory: [
    { frequency: 392, duration: 0.18, volume: 0.045, type: "triangle" },
    { frequency: 523.25, duration: 0.2, volume: 0.05, type: "triangle", delay: 0.11 },
    { frequency: 659.25, duration: 0.24, volume: 0.055, type: "triangle", delay: 0.22 },
    { frequency: 783.99, duration: 0.36, volume: 0.05, type: "triangle", delay: 0.34 },
  ],
  defeat: [
    { frequency: 330, endFrequency: 247, duration: 0.22, volume: 0.045, type: "triangle" },
    { frequency: 220, endFrequency: 110, duration: 0.34, volume: 0.055, type: "triangle", delay: 0.17 },
  ],
  draw: [
    { frequency: 293.66, duration: 0.28, volume: 0.04, type: "sine" },
    { frequency: 349.23, duration: 0.28, volume: 0.035, type: "sine" },
    { frequency: 440, duration: 0.28, volume: 0.03, type: "sine" },
  ],
  invalid: [
    { frequency: 115, endFrequency: 82, duration: 0.12, volume: 0.045, type: "sawtooth" },
    { frequency: 98, endFrequency: 72, duration: 0.11, volume: 0.04, type: "sawtooth", delay: 0.11 },
  ],
};

const THEME_AUDIO: Record<ThemeId, { ratio: number; wave: OscillatorType; notes: number[]; tempo: number }> = {
  classic: { ratio: .94, wave: "triangle", notes: [220, 277, 330, 415], tempo: 960 },
  ocean: { ratio: 1.08, wave: "sine", notes: [196, 247, 294, 370], tempo: 1120 },
  blockfield: { ratio: 1, wave: "triangle", notes: [196, 233, 294, 349], tempo: 900 },
  toybox: { ratio: 1.18, wave: "square", notes: [262, 330, 392, 523], tempo: 820 },
  "arena-pop": { ratio: 1.12, wave: "sawtooth", notes: [220, 294, 349, 440], tempo: 760 },
  "high-fantasy": { ratio: .86, wave: "triangle", notes: [165, 220, 247, 330], tempo: 1240 },
  "arcane-cards": { ratio: .9, wave: "sine", notes: [185, 233, 277, 370], tempo: 1080 },
  "iron-legions": { ratio: .78, wave: "square", notes: [110, 147, 165, 220], tempo: 980 },
  "shadow-shogun": { ratio: .82, wave: "sine", notes: [147, 196, 220, 294], tempo: 1320 },
  "neon-grid": { ratio: 1.22, wave: "sawtooth", notes: [220, 277, 415, 554], tempo: 720 },
  mono: { ratio: 1, wave: "sine", notes: [196, 294, 392, 294], tempo: 1040 },
};

function currentTheme(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return normalizeTheme(document.documentElement.dataset.theme);
}

export function playGameSound(sound: GameSound): void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return;
  const profile = THEME_AUDIO[currentTheme()];
  const master = readMasterVolume();
  for (const soundTone of SOUND_TONES[sound]) tone(context, {
    ...soundTone,
    frequency: soundTone.frequency * profile.ratio,
    endFrequency: soundTone.endFrequency ? soundTone.endFrequency * profile.ratio : undefined,
    volume: soundTone.volume * master,
    type: soundTone.type === "sine" ? "sine" : profile.wave,
  });
}

export interface ScheduledGameSound {
  sound: GameSound;
  delay: number;
}

export function gameSoundTimeline(sounds: readonly GameSound[]): ScheduledGameSound[] {
  let delay = 0;
  return sounds.map((sound) => {
    const scheduled = { sound, delay };
    const duration = Math.max(
      ...SOUND_TONES[sound].map((entry) => (entry.delay ?? 0) + entry.duration),
    );
    delay += duration + 0.06;
    return scheduled;
  });
}

export function playGameSounds(sounds: readonly GameSound[]): void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return;
  const profile = THEME_AUDIO[currentTheme()];
  const master = readMasterVolume();
  for (const scheduled of gameSoundTimeline(sounds)) {
    for (const soundTone of SOUND_TONES[scheduled.sound]) tone(context, {
      ...soundTone,
      delay: scheduled.delay + (soundTone.delay ?? 0),
      frequency: soundTone.frequency * profile.ratio,
      endFrequency: soundTone.endFrequency
        ? soundTone.endFrequency * profile.ratio
        : undefined,
      volume: soundTone.volume * master,
      type: soundTone.type === "sine" ? "sine" : profile.wave,
    });
  }
}

export function startThemeMusic(theme: ThemeId): () => void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return () => {};
  const profile = THEME_AUDIO[theme];
  let step = 0;
  const playStep = () => {
    const master = readMasterVolume();
    const note = profile.notes[step % profile.notes.length];
    tone(context, {
      frequency: note,
      duration: Math.min(.72, profile.tempo / 1_700),
      volume: 0.018 * master,
      type: profile.wave,
    });
    if (step % 2 === 0) tone(context, {
      frequency: note / 2,
      duration: Math.min(.9, profile.tempo / 1_350),
      volume: 0.009 * master,
      type: "sine",
    });
    step += 1;
  };
  playStep();
  const timer = window.setInterval(playStep, profile.tempo);
  return () => window.clearInterval(timer);
}
