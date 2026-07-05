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
//
// Music plays through Web Audio (decoded AudioBuffer + a looping
// AudioBufferSourceNode), NOT a native `<audio loop>` element. That's
// deliberate: MP3 encoding adds a few dozen milliseconds of silent
// "priming" padding at the start of the file (an artifact of the codec,
// not of our synthesis), and a plain `<audio loop>` element replays that
// padding as an audible gap/click every single time the track wraps.
// `decodeAudioData` strips that padding when it decodes to raw PCM, so
// looping the decoded buffer via Web Audio is sample-accurate and gapless
// - this is what made the loop sound "abrupt" before, independent of the
// music itself.

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

let musicGain = null;
let musicBuffer = null; // decoded AudioBuffer, once loaded
let musicLoadPromise = null;
let musicSource = null; // currently-playing AudioBufferSourceNode, or null
let unlocked = false;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.6;
    sfxGain.connect(audioCtx.destination);
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.35;
    musicGain.connect(audioCtx.destination);
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

async function loadMusicBuffer() {
  const ctx = getAudioCtx();
  try {
    const res = await fetch(MUSIC_URL);
    const arrayBuffer = await res.arrayBuffer();
    musicBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn("Failed to load background music", e);
  }
}

/** Call once at boot. Kicks off SFX + music decoding (doesn't play anything yet). */
export function initAudio() {
  if (!sfxLoadPromise) sfxLoadPromise = loadSfxBuffers();
  if (!musicLoadPromise) musicLoadPromise = loadMusicBuffer();
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

async function startMusic() {
  if (!musicLoadPromise) initAudio();
  await musicLoadPromise;
  if (!musicBuffer || musicSource) return; // already playing, or failed to load
  const ctx = getAudioCtx();
  const source = ctx.createBufferSource();
  source.buffer = musicBuffer;
  // Looping the decoded AudioBuffer directly (rather than a native <audio
  // loop> element playing the compressed file) is what makes this gapless:
  // decodeAudioData already stripped the MP3 encoder's silent padding, so
  // the loop point here is the exact last sample flowing into the exact
  // first sample of our synthesized track, not the codec's added silence.
  source.loop = true;
  source.connect(musicGain);
  source.start(0);
  musicSource = source;
}

function stopMusic() {
  if (musicSource) {
    musicSource.stop();
    musicSource.disconnect();
    musicSource = null;
  }
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
