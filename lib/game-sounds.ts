import { Chess } from "chess.js";
import type { GameSnapshot, MoveContinuation, Promotion, PublicMove } from "./game-types";
import {
  THEME_MUSIC_PROFILES,
  type MusicStep,
  type MusicVoiceProfile,
  type ThemeMusicProfile,
} from "./theme-music";
import { DEFAULT_THEME, normalizeTheme, type ThemeId } from "./themes";

export type GameSound = "move" | "capture" | "check" | "castle" | "queen_capture" | "promotion_q" | "promotion_r" | "promotion_b" | "promotion_n" | "victory" | "defeat" | "draw" | "invalid";

const SOUND_PREFERENCE_KEY = "chessriot:sound";
const MUSIC_PREFERENCE_KEY = "chessriot:music";
const MASTER_VOLUME_KEY = "chessriot:master-volume";
const EFFECTS_VOLUME_KEY = "chessriot:effects-volume";
const MUSIC_VOLUME_KEY = "chessriot:music-volume";
const DEFAULT_MASTER_VOLUME = 0.45;
export const AUDIO_PREFERENCES_EVENT = "chessriot:audio-preferences";
export interface AudioPreferences {
  effectsOn: boolean;
  musicOn: boolean;
  masterVolume: number;
  effectsVolume?: number;
  musicVolume?: number;
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
  if (typeof window === "undefined") return DEFAULT_MASTER_VOLUME;
  try {
    const raw = localStorage.getItem(MASTER_VOLUME_KEY);
    if (raw === null) return DEFAULT_MASTER_VOLUME;
    const stored = Number(raw);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1
      ? stored
      : DEFAULT_MASTER_VOLUME;
  } catch {
    return DEFAULT_MASTER_VOLUME;
  }
}

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(1, volume));
}

export function writeMasterVolume(volume: number): void {
  try {
    localStorage.setItem(MASTER_VOLUME_KEY, String(clampVolume(volume)));
  } catch {
    // The current tab still uses the selected volume.
  }
}

function readChannelVolume(key: string): number {
  if (typeof window === "undefined") return DEFAULT_MASTER_VOLUME;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return readMasterVolume();
    const stored = Number(raw);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1
      ? stored
      : readMasterVolume();
  } catch {
    return readMasterVolume();
  }
}

function writeChannelVolume(key: string, volume: number): void {
  try {
    localStorage.setItem(key, String(clampVolume(volume)));
  } catch {
    // The current tab still uses the selected volume.
  }
}

export function readEffectsVolume(): number {
  return readChannelVolume(EFFECTS_VOLUME_KEY);
}

export function writeEffectsVolume(volume: number): void {
  writeChannelVolume(EFFECTS_VOLUME_KEY, volume);
}

export function readMusicVolume(): number {
  return readChannelVolume(MUSIC_VOLUME_KEY);
}

export function writeMusicVolume(volume: number): void {
  writeChannelVolume(MUSIC_VOLUME_KEY, volume);
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
    const continuation: MoveContinuation[] = move.continuation
      ?? (move.second ? [move.second] : []);
    let current = chess;
    for (const leg of continuation) {
      const fields = current.fen().split(" ");
      fields[1] = move.color;
      current = new Chess(fields.join(" "));
      const continued = current.move({
        from: leg.from,
        to: leg.to,
        ...(leg.promotion ? { promotion: leg.promotion } : {}),
      });
      if (continued.captured === "q") return true;
    }
    return false;
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
    const continuation: MoveContinuation[] = move.continuation?.length
      ? move.continuation
      : move.second ? [move.second] : [];
    const sans = [move.san, ...continuation.map((leg) => leg.san)];
    const promotions = [move.promotion, ...continuation.map((leg) => leg.promotion ?? null)]
      .filter((promotion): promotion is Promotion => Boolean(promotion));
    for (const promotion of promotions) {
      special.push(`promotion_${promotion}` as GameSound);
    }
    if (capturedQueen(move, fallbackFen)) special.push("queen_capture");
    if (sans.some((san) => san.startsWith("O-O"))) {
      special.push("castle");
    }
    const moveIsCheckmate = sans.some((san) => san.includes("#"));
    const terminalCheckmate = index === newMoves.length - 1
      && next.status === "completed"
      && next.outcome?.reason === "checkmate";
    if (
      sans.some((san) => san.includes("+"))
      || (index === newMoves.length - 1 && next.check && !terminalCheckmate)
    ) {
      special.push("check");
    }
    // A mating move gets the result sound, not a redundant ordinary check cue.
    if (moveIsCheckmate) {
      const checkIndex = special.indexOf("check");
      if (checkIndex >= 0) special.splice(checkIndex, 1);
    }
    sounds.push(...(special.length
      ? special
      : [sans.some((san) => san.includes("x")) ? "capture" : "move"] as GameSound[]));
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

const THEME_EFFECTS: Record<ThemeId, { ratio: number; wave: OscillatorType }> = {
  classic: { ratio: .94, wave: "triangle" },
  ocean: { ratio: 1.08, wave: "sine" },
  blockfield: { ratio: 1, wave: "triangle" },
  toybox: { ratio: 1.18, wave: "square" },
  "arena-pop": { ratio: 1.12, wave: "sawtooth" },
  "high-fantasy": { ratio: .86, wave: "triangle" },
  "mythic-beasts": { ratio: .89, wave: "sawtooth" },
  "arcane-cards": { ratio: .9, wave: "sine" },
  "iron-legions": { ratio: .78, wave: "square" },
  "shadow-shogun": { ratio: .82, wave: "sine" },
  "neon-grid": { ratio: 1.22, wave: "sawtooth" },
  mono: { ratio: 1, wave: "sine" },
};

function currentTheme(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return normalizeTheme(document.documentElement.dataset.theme);
}

export function playGameSound(sound: GameSound): void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return;
  const profile = THEME_EFFECTS[currentTheme()];
  const effectsVolume = readEffectsVolume();
  for (const soundTone of SOUND_TONES[sound]) tone(context, {
    ...soundTone,
    frequency: soundTone.frequency * profile.ratio,
    endFrequency: soundTone.endFrequency ? soundTone.endFrequency * profile.ratio : undefined,
    volume: soundTone.volume * effectsVolume,
    type: soundTone.type === "sine" ? "sine" : profile.wave,
  });
}

export interface ScheduledGameSound {
  sound: GameSound;
  delay: number;
}

export function gameSoundTimeline(sounds: readonly GameSound[]): ScheduledGameSound[] {
  let delay = 0;
  return sounds.map((sound, index) => {
    // Let the move/capture animation land before announcing the result. A
    // standalone resignation or draw still sounds immediately.
    if (index > 0 && (sound === "victory" || sound === "defeat" || sound === "draw")) {
      delay = Math.max(delay, 1.5);
    }
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
  const profile = THEME_EFFECTS[currentTheme()];
  const effectsVolume = readEffectsVolume();
  for (const scheduled of gameSoundTimeline(sounds)) {
    for (const soundTone of SOUND_TONES[scheduled.sound]) tone(context, {
      ...soundTone,
      delay: scheduled.delay + (soundTone.delay ?? 0),
      frequency: soundTone.frequency * profile.ratio,
      endFrequency: soundTone.endFrequency
        ? soundTone.endFrequency * profile.ratio
        : undefined,
      volume: soundTone.volume * effectsVolume,
      type: soundTone.type === "sine" ? "sine" : profile.wave,
    });
  }
}

function musicFrequency(profile: ThemeMusicProfile, semitones: number, octave: number): number {
  return profile.rootHz * (2 ** (semitones / 12)) * (2 ** octave);
}

function connectMusicGain(
  context: AudioContext,
  gain: GainNode,
  destination: AudioNode,
  pan: number,
): StereoPannerNode | null {
  if (typeof context.createStereoPanner !== "function") {
    gain.connect(destination);
    return null;
  }
  const panner = context.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  gain.connect(panner);
  panner.connect(destination);
  return panner;
}

function scheduleMusicOscillator(
  context: AudioContext,
  destination: AudioNode,
  active: Set<OscillatorNode>,
  input: {
    at: number;
    duration: number;
    frequency: number;
    endFrequency?: number;
    level: number;
    wave: OscillatorType;
    attack: number;
    filterHz: number;
    pan: number;
    detune?: number;
  },
): void {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const start = Math.max(context.currentTime, input.at);
  const duration = Math.max(0.035, input.duration);
  const end = start + duration;
  const attackEnd = Math.min(end - 0.012, start + Math.max(0.004, input.attack));
  const releaseStart = Math.max(attackEnd, end - Math.min(0.16, duration * 0.38));

  oscillator.type = input.wave;
  oscillator.frequency.setValueAtTime(Math.max(24, input.frequency), start);
  oscillator.detune.setValueAtTime(input.detune ?? 0, start);
  if (input.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(24, input.endFrequency),
      end,
    );
  }
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(input.filterHz, start);
  filter.Q.setValueAtTime(0.7, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, input.level), attackEnd);
  gain.gain.setValueAtTime(Math.max(0.0002, input.level), releaseStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(filter);
  filter.connect(gain);
  const panner = connectMusicGain(context, gain, destination, input.pan);
  oscillator.onended = () => {
    active.delete(oscillator);
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
  active.add(oscillator);
  oscillator.start(start);
  oscillator.stop(end + 0.012);
}

function scheduleMusicVoice(
  context: AudioContext,
  destination: AudioNode,
  active: Set<OscillatorNode>,
  profile: ThemeMusicProfile,
  voice: MusicVoiceProfile,
  note: MusicStep,
  at: number,
  stepSeconds: number,
  accent: number,
): void {
  if (note === null) return;
  const notes = typeof note === "number" ? [note] : note;
  notes.forEach((semitones, index) => scheduleMusicOscillator(
    context,
    destination,
    active,
    {
      at,
      duration: stepSeconds * voice.gate,
      frequency: musicFrequency(profile, semitones, voice.octave),
      level: voice.level * accent / Math.max(1, Math.sqrt(notes.length)),
      wave: voice.wave,
      attack: voice.attack,
      filterHz: voice.filterHz,
      pan: voice.pan + (notes.length > 1 ? (index - (notes.length - 1) / 2) * 0.08 : 0),
      detune: voice.detune,
    },
  ));
}

function scheduleMusicStep(
  context: AudioContext,
  destination: AudioNode,
  active: Set<OscillatorNode>,
  profile: ThemeMusicProfile,
  step: number,
  at: number,
  stepSeconds: number,
): void {
  const index = step % 16;
  const accent = index % 4 === 0 ? 1.12 : index % 2 === 0 ? 1.02 : 0.92;
  scheduleMusicVoice(
    context, destination, active, profile, profile.lead,
    profile.lead.pattern[index], at, stepSeconds, accent,
  );
  scheduleMusicVoice(
    context, destination, active, profile, profile.bass,
    profile.bass.pattern[index], at, stepSeconds, accent,
  );
  scheduleMusicVoice(
    context, destination, active, profile, profile.harmony,
    profile.harmony.pattern[index], at, stepSeconds, accent,
  );

  const percussion = profile.percussion;
  if (percussion.pattern[index]) {
    scheduleMusicOscillator(context, destination, active, {
      at,
      duration: percussion.decay,
      frequency: percussion.frequency,
      endFrequency: percussion.endFrequency,
      level: percussion.level * accent,
      wave: percussion.wave,
      attack: 0.003,
      filterHz: 2_600,
      pan: percussion.pan,
    });
  }
}

let stopActiveThemeMusic: ((fadeSeconds?: number) => void) | null = null;

export function startThemeMusic(theme: ThemeId): () => void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return () => {};
  stopActiveThemeMusic?.(0.18);
  const profile = THEME_MUSIC_PROFILES[theme];
  const bus = context.createGain();
  const active = new Set<OscillatorNode>();
  const baseStepSeconds = 30 / profile.bpm;
  let nextStepAt = context.currentTime + 0.035;
  let step = 0;
  let stopped = false;
  let appliedVolume = readMusicVolume();
  bus.gain.setValueAtTime(0.0001, context.currentTime);
  bus.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, appliedVolume),
    context.currentTime + 0.18,
  );
  bus.connect(context.destination);

  const scheduleAhead = () => {
    if (stopped) return;
    const now = context.currentTime;
    const nextVolume = readMusicVolume();
    if (Math.abs(nextVolume - appliedVolume) > 0.001) {
      appliedVolume = nextVolume;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(Math.max(0.0001, nextVolume), now, 0.035);
    }
    while (nextStepAt < now + 0.24) {
      scheduleMusicStep(
        context,
        bus,
        active,
        profile,
        step,
        nextStepAt,
        baseStepSeconds,
      );
      const swing = step % 2 === 0 ? profile.swing : -profile.swing;
      nextStepAt += baseStepSeconds * (1 + swing);
      step += 1;
    }
  };

  scheduleAhead();
  const timer = window.setInterval(scheduleAhead, 75);
  const stop = (fadeSeconds = 0.18) => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    const now = context.currentTime;
    const fade = Math.max(0.01, Math.min(0.5, fadeSeconds));
    const endsAt = now + fade;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
    bus.gain.exponentialRampToValueAtTime(0.0001, endsAt);
    for (const oscillator of active) {
      try {
        oscillator.stop(endsAt + 0.01);
      } catch {
        // A tone that ended between scheduling and cleanup needs no action.
      }
    }
    active.clear();
    window.setTimeout(() => bus.disconnect(), (fade + 0.04) * 1_000);
    if (stopActiveThemeMusic === stop) stopActiveThemeMusic = null;
  };
  stopActiveThemeMusic = stop;
  return stop;
}
