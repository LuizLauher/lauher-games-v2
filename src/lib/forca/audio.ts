type Prefs = { music: boolean; sfx: boolean };

const PREF_KEY = "lauher-forca-audio-v1";
const MELODY = [196, 233.08, 261.63, 293.66, 261.63, 233.08, 220, 196];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let prefs: Prefs = { music: true, sfx: true };
let loaded = false;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let nextNoteAt = 0;
let step = 0;
const listeners = new Set<(prefs: Prefs) => void>();

function readPrefs(): Prefs {
  if (loaded) return prefs;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || "null") as Partial<Prefs> | null;
    if (saved && typeof saved.music === "boolean") prefs.music = saved.music;
    if (saved && typeof saved.sfx === "boolean") prefs.sfx = saved.sfx;
  } catch {
    prefs = { music: true, sfx: true };
  }
  return prefs;
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
  for (const listener of listeners) listener(prefs);
}

export function audioPrefs(): Prefs {
  return readPrefs();
}

export function subscribeAudio(listener: (prefs: Prefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function curve(on: boolean, amount: number): number {
  return on ? amount * amount : 0;
}

function applyGains(): void {
  if (!ctx || !musicBus || !sfxBus) return;
  const now = ctx.currentTime;
  musicBus.gain.setTargetAtTime(curve(prefs.music, 0.22), now, 0.03);
  sfxBus.gain.setTargetAtTime(curve(prefs.sfx, 0.8), now, 0.02);
}

export function unlockAudio(): void {
  readPrefs();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  if (!ctx) {
    ctx = new AudioCtx({ latencyHint: "interactive" });
    master = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(ctx.destination);
    master.gain.value = 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  applyGains();
  startMusic();
}

function tone(
  bus: GainNode | null,
  frequency: number,
  when: number,
  duration: number,
  type: OscillatorType,
  gain: number,
): void {
  if (!ctx || !bus) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(amp);
  amp.connect(bus);
  osc.start(when);
  osc.stop(when + duration + 0.02);
  osc.onended = () => {
    osc.disconnect();
    amp.disconnect();
  };
}

function playSfx(notes: Array<{ f: number; d: number; t: OscillatorType; g: number; at: number }>): void {
  if (!ctx || !prefs.sfx) return;
  const start = ctx.currentTime + 0.01;
  for (const note of notes) tone(sfxBus, note.f, start + note.at, note.d, note.t, note.g);
}

function scheduleMusic(): void {
  if (!ctx || !musicBus) return;
  if (!prefs.music) return;
  const horizon = ctx.currentTime + 0.7;
  if (nextNoteAt < ctx.currentTime) nextNoteAt = ctx.currentTime + 0.05;
  while (nextNoteAt < horizon) {
    tone(musicBus, MELODY[step % MELODY.length]!, nextNoteAt, 0.36, "sine", 0.18);
    step += 1;
    nextNoteAt += 0.48;
  }
}

function startMusic(): void {
  if (musicTimer || !ctx) return;
  musicTimer = setInterval(scheduleMusic, 240);
  scheduleMusic();
}

export function setMusicEnabled(on: boolean): void {
  unlockAudio();
  prefs = { ...readPrefs(), music: on };
  savePrefs();
  applyGains();
}

export function setSfxEnabled(on: boolean): void {
  unlockAudio();
  prefs = { ...readPrefs(), sfx: on };
  savePrefs();
  applyGains();
}

export function playHit(): void {
  playSfx([{ f: 520, d: 0.12, t: "sine", g: 0.2, at: 0 }, { f: 780, d: 0.16, t: "triangle", g: 0.12, at: 0.07 }]);
}

export function playMiss(): void {
  playSfx([{ f: 196, d: 0.22, t: "sawtooth", g: 0.08, at: 0 }, { f: 120, d: 0.28, t: "triangle", g: 0.16, at: 0.04 }]);
}

export function playStart(): void {
  playSfx([
    { f: 392, d: 0.12, t: "triangle", g: 0.16, at: 0 },
    { f: 523.25, d: 0.18, t: "triangle", g: 0.16, at: 0.1 },
  ]);
}

export function playWin(): void {
  playSfx([
    { f: 392, d: 0.14, t: "triangle", g: 0.16, at: 0 },
    { f: 493.88, d: 0.14, t: "triangle", g: 0.16, at: 0.12 },
    { f: 587.33, d: 0.22, t: "triangle", g: 0.18, at: 0.24 },
  ]);
}

export function playLose(): void {
  playSfx([
    { f: 311, d: 0.16, t: "sine", g: 0.16, at: 0 },
    { f: 233, d: 0.2, t: "sine", g: 0.14, at: 0.14 },
    { f: 174, d: 0.32, t: "triangle", g: 0.14, at: 0.28 },
  ]);
}

export function playJoin(): void {
  playSfx([{ f: 660, d: 0.12, t: "sine", g: 0.1, at: 0 }]);
}

export function playLeave(): void {
  playSfx([{ f: 280, d: 0.14, t: "sine", g: 0.1, at: 0 }]);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") unlockAudio();
  });
}
