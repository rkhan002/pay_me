// Background music + sound effects. Two independent on/off toggles
// (music, SFX), each persisted to localStorage so a player's preference
// survives reloads - this is purely a local UI preference, not game state,
// so there's no reason to round-trip it through Supabase.
//
// Browsers refuse to play any audio until the page has seen a user
// gesture (a click, a keypress) - trying to start music at page load
// just throws. `unlockOnFirstGesture()` is called once from main.js and
// does nothing until that first gesture arrives, at which point it
// resumes the (until-then-suspended) AudioContext and starts the music
// loop if the player has left music enabled.

const MUSIC_KEY = "payme:musicEnabled";
const SFX_KEY = "payme:sfxEnabled";

const SFX_FILES = {
  draw: "/assets/audio/draw.mp3",
  discard: "/assets/audio/discard.mp3",
  meld: "/assets/audio/meld.mp3",
  layoff: "/assets/audio/layoff.mp3",
  unmeld: "/assets/audio/unmeld.mp3",
  wild: "/assets/audio/wild.mp3",
  payme: "/assets/audio/payme.mp3",
  turn: "/assets/audio/turn.mp3",
  win: "/assets/audio/win.mp3",
};

const MUSIC_URL = "/assets/audio/music_loop.mp3";

function readBoolPref(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

let musicEnabled = readBoolPref(MUSIC_KEY, true);
let sfxEnabled = readBoolPref(SFX_KEY, true);

let audioCtx = null;
let sfxGain = null;
const sfxBuffers = new Map(); // name -> decoded AudioBuffer
let sfxLoadPromise = null;

let musicEl = null;
let unlocked = false;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.6;
    sfxGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

async function loadSfxBuffers() {
  const ctx = getAudioCtx();
  await Promise.all(
    Object.entries(SFX_FILES).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        sfxBuffers.set(name, buffer);
      } catch (e) {
        // A missing/failed SFX shouldn't break the game - just skip it.
        console.warn(`Failed to load sound "${name}"`, e);
      }
    }),
  );
}

/** Call once at boot. Kicks off SFX decoding and prepares (but doesn't play) the music element. */
export function initAudio() {
  if (!sfxLoadPromise) sfxLoadPromise = loadSfxBuffers();

  if (!musicEl) {
    musicEl = new Audio(MUSIC_URL);
    musicEl.loop = true;
    musicEl.volume = 0.35;
    musicEl.preload = "auto";
  }
}

/** Plays a one-shot SFX by name if sound effects are enabled. Silently no-ops otherwise (missing sound, not yet loaded, disabled, or not yet unlocked). */
export function playSfx(name) {
  if (!sfxEnabled || !unlocked) return;
  const buffer = sfxBuffers.get(name);
  if (!buffer || !audioCtx) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(sfxGain);
  source.start(0);
}

/** Resumes the AudioContext and starts music (if enabled) - only works after a real user gesture. */
export function unlockOnFirstGesture() {
  if (unlocked) return;
  unlocked = true;
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  if (musicEnabled) startMusic();
}

function startMusic() {
  if (!musicEl) initAudio();
  musicEl.play().catch(() => {
    // Autoplay can still be refused in edge cases (e.g. a gesture that
    // doesn't count) - the music toggle button gives the player a manual
    // retry, so this is safe to just swallow.
  });
}

function stopMusic() {
  if (musicEl) musicEl.pause();
}

export function isMusicEnabled() {
  return musicEnabled;
}

export function isSfxEnabled() {
  return sfxEnabled;
}

export function setMusicEnabled(enabled) {
  musicEnabled = enabled;
  localStorage.setItem(MUSIC_KEY, String(enabled));
  if (!unlocked) return;
  if (enabled) startMusic();
  else stopMusic();
}

export function setSfxEnabled(enabled) {
  sfxEnabled = enabled;
  localStorage.setItem(SFX_KEY, String(enabled));
}

export function toggleMusic() {
  setMusicEnabled(!musicEnabled);
  return musicEnabled;
}

export function toggleSfx() {
  setSfxEnabled(!sfxEnabled);
  return sfxEnabled;
}
