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
//
// A browser is free to suspend a running AudioContext again after the
// initial unlock - screen lock, an incoming call/notification, switching
// apps, or (on iOS Safari especially) just backgrounding the tab for a
// few seconds all do it, and Safari on iOS is considerably more
// aggressive about this than desktop Safari. `unlockOnFirstGesture()`
// used to be truly one-shot (an internal flag blocked it from ever
// running again), so once the context got re-suspended mid-game, every
// later `playSfx()` call would schedule a sound on a silent, suspended
// context - it fails silently, not with an error, which is exactly what
// "sound randomly turns off partway through" looks like from the
// player's side, and why it showed up on an iPad and not a laptop.
// `resumeIfNeeded()` below is called opportunistically from several
// places (every SFX attempt, every subsequent tap/click/keypress, and
// whenever the tab/app becomes visible again) so the context gets
// nudged back to "running" the moment any of those next occur, instead
// of staying silently stuck.

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

// A ~0.15s clip of pure silence (all-zero PCM samples), inlined so there's
// no extra network request. See unmuteSilentSwitch() below for what it's for.
const SILENT_CLIP =
  "data:audio/wav;base64,UklGRoQJAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YWAJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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

// iOS routes Web Audio to an audio session that the hardware silent/ring
// switch mutes - so with the phone on silent, the game goes quiet even though
// the volume is up and both in-app toggles say "on". Playing a REAL
// HTMLMediaElement from within a user gesture flips iOS into its "playback"
// audio session, which the silent switch does NOT mute, and the Web Audio
// context then rides along in that same session. We keep a short silent clip
// looping quietly to hold that session open, and re-nudge it whenever we
// resume the context (e.g. after the tab was backgrounded). Harmless no-op on
// Android/desktop, where Web Audio already ignores any such switch.
let silentEl = null;
function unmuteSilentSwitch() {
  if (!silentEl) {
    silentEl = document.createElement("audio");
    silentEl.src = SILENT_CLIP;
    silentEl.loop = true;
    // Not muted / not volume 0 on purpose: iOS only switches the audio session
    // for an element that actually plays audible-category output. The clip's
    // samples are silent, so it's inaudible without relying on a mute flag.
    silentEl.setAttribute("playsinline", "");
    silentEl.setAttribute("preload", "auto");
  }
  if (silentEl.paused) silentEl.play().catch(() => {});
}

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

// Covers both the standard "suspended" state and Safari's non-standard
// "interrupted" state (used for phone calls, Siri, etc.) - anything that
// isn't "running" gets a resume attempt. Safe to call constantly: resuming
// an already-running context is a harmless no-op.
function resumeIfNeeded() {
  if (audioCtx && audioCtx.state !== "running") {
    audioCtx.resume().catch(() => {});
  }
  unmuteSilentSwitch();
}

let recoveryListenersInstalled = false;

// Beyond the one-time gesture that creates/unlocks the context, keep
// nudging it back to "running" for the rest of the session - on the next
// tap/click/keypress (covers the "came back from being backgrounded"
// case, since resuming from a non-autoplay suspension doesn't need a
// fresh gesture, just *a* later event loop turn) and whenever the tab or
// installed-to-homescreen app regains visibility.
function installRecoveryListeners() {
  if (recoveryListenersInstalled) return;
  recoveryListenersInstalled = true;
  document.addEventListener("click", resumeIfNeeded);
  document.addEventListener("touchend", resumeIfNeeded);
  document.addEventListener("keydown", resumeIfNeeded);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeIfNeeded();
  });
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
  // Opportunistic, not a guarantee: if the context got suspended (see the
  // note above) this SFX call may still land before the resume completes,
  // but it also means the very next one won't - rather than staying
  // silent for the rest of the session.
  resumeIfNeeded();
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(sfxGain);
  source.start(0);
}

/** Resumes the AudioContext and starts music (if enabled) - only works after a real user gesture. */
export function unlockOnFirstGesture() {
  if (unlocked) return;
  unlocked = true;
  // Flip iOS to its "playback" session (within this gesture) so nothing that
  // follows is muted by the silent switch. See unmuteSilentSwitch().
  unmuteSilentSwitch();
  const ctx = getAudioCtx();
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  installRecoveryListeners();
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
  // Belt-and-suspenders: a looping source shouldn't ever fire "ended" on
  // its own, but if a browser ever stops it out from under us (rather
  // than just suspending the context, which doesn't fire this), don't
  // leave musicSource pointing at a dead node - clear it and, if the
  // player still has music on, start a fresh one. The identity check
  // guards against a stale handler from a previous source clearing out
  // a newer one it raced with (e.g. a quick off-then-on toggle).
  source.onended = () => {
    if (musicSource !== source) return;
    musicSource = null;
    if (musicEnabled && unlocked) startMusic();
  };
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
