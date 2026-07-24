import type { GameSnapshot } from "./game-types";

export type GameSound = "move" | "capture" | "check" | "victory" | "defeat" | "draw" | "invalid";

const SOUND_PREFERENCE_KEY = "chessriot:sound";
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

export function classifyGameSound(previous: GameSnapshot | null, next: GameSnapshot): GameSound | null {
  if (!previous || next.version <= previous.version) return null;
  if (previous.status !== "completed" && next.status === "completed" && next.outcome) {
    if (next.outcome.winner === null) return "draw";
    return next.outcome.winner === next.you.color ? "victory" : "defeat";
  }
  if (next.plyCount <= previous.plyCount) return null;
  if (next.check) return "check";
  const lastMove = next.moves.at(-1);
  if (!lastMove) return null;
  return lastMove.san.includes("x") ? "capture" : "move";
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

export function playGameSound(sound: GameSound): void {
  const context = getAudioContext();
  if (!context || context.state !== "running") return;
  for (const soundTone of SOUND_TONES[sound]) tone(context, soundTone);
}
