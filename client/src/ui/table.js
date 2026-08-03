import {
  getState,
  setState,
  toggleCardSelection,
  clearSelection,
  cardKey,
} from "../state/store.js";
import { renderCard, renderCardFan, renderCardBack } from "./cards.js";
import { avatarSrc } from "./avatars.js";
import { commitOrder, sortByRank, sortBySuit, makeHandFanDraggable } from "./handOrder.js";
import {
  startHand,
  drawStock,
  drawDiscard,
  discardCard,
  proposeMeld,
  layOffCard,
  passLayoff,
  stealWild,
  unmeld,
} from "../network/intents.js";
import { loadRoom, loadHand, loadStandings, applyHandView } from "../network/queries.js";
import { inviteLink, clearPersistedRoom, setRoomInUrl } from "../network/reconnect.js";
import { isMusicEnabled, isSfxEnabled, toggleMusic, toggleSfx } from "../audio/audioManager.js";

// --- One-shot enter-animation tracking (motion pass) -------------------
// renderTable() rebuilds the whole DOM on every state change, so a CSS
// @keyframes on .card/.meld would replay on EVERY re-render. To fire the
// deal-in / meld-in animations exactly once (only when a card or meld is
// genuinely new), we remember what was on screen last render and diff.
let prevHandKeys = new Set();
let prevMeldIds = new Set();

// --- Dealer-pitch animation (motion pass) ------------------------------
// New cards fly out of the stock (or discard) pile and spin into the hand,
// like a dealer pitching cards. The board is fully rebuilt (innerHTML = "") on
// every state change, and a deal/draw usually triggers a quick burst of
// re-renders (optimistic update, the server refresh, a realtime echo). A naive
// animation on the freshly built card elements gets wiped mid-flight by the
// next rebuild. So instead:
//   1) PLAN which card keys should fly, and from where, as state changes.
//   2) HIDE those cards on every render until they've actually flown.
//   3) FLY them from a debounced timer, so it runs once the burst has settled;
//      if a later rebuild interrupts a flight the card is simply re-hidden and
//      left queued, so the next settle replays it.
// Motion is FLIP + the Web Animations API.
let curHandId = null; // hand the fly bookkeeping below belongs to
let flyPlan = new Map(); // cardKey -> "stock" | "discard": queued to fly (hidden)
let flownKeys = new Set(); // cardKey already flown this hand (never fly again)
let pitchTimer = null;
let prevPendingDraw = false; // was the previous render mid stock-draw?
let pendingFlyArmed = false; // placeholder already queued/flown for this draw
const PENDING_KEY = "__pending_draw__"; // sentinel key for the face-down placeholder

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function rectOf(el) {
  return el ? el.getBoundingClientRect() : null;
}
function cssEscape(v) {
  return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&");
}
// Hands whose opening deal this browser has already animated - kept in
// sessionStorage so a refresh/reconnect doesn't re-deal an in-progress hand (a
// genuinely new deal still animates).
function dealtHands() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem("payme:dealtHands") || "[]"));
  } catch {
    return new Set();
  }
}
function markHandDealt(id) {
  if (!id) return;
  try {
    const set = dealtHands();
    set.add(id);
    sessionStorage.setItem("payme:dealtHands", JSON.stringify([...set]));
  } catch {
    /* sessionStorage unavailable - harmless, deal just replays */
  }
}

// Work out which cards should fly this render, given the keys new to the hand
// vs the previous render. A full opening deal flies every card from the stock;
// a single new card is a pickup and flies from whichever pile it came from.
function planHandPitch(state, newKeys) {
  if (prefersReducedMotion() || !state.hand) return;
  const handId = state.hand.id;
  if (handId !== curHandId) {
    curHandId = handId;
    flyPlan = new Map();
    flownKeys = new Set();
    pendingFlyArmed = false;
  }
  const total = state.myCards.length;
  const isFullDeal = newKeys.size === total && total > 1 && !dealtHands().has(handId);
  const isReveal = prevPendingDraw && !state.pendingDraw;

  if (isFullDeal) {
    markHandDealt(handId);
    for (const c of state.myCards) {
      const k = cardKey(c);
      if (!flownKeys.has(k)) flyPlan.set(k, "stock");
    }
    return;
  }

  // A stock draw is the one action where the client doesn't yet know the card
  // (the stock is server-only). Fly a face-down placeholder out of the deck the
  // instant the draw registers, so the click feels immediate; the real card
  // then swaps into the placeholder's spot when the server replies.
  if (state.pendingDraw && !pendingFlyArmed) {
    flyPlan.set(PENDING_KEY, "stock");
    pendingFlyArmed = true;
  }
  if (isReveal) {
    pendingFlyArmed = false;
    flyPlan.delete(PENDING_KEY);
  }

  for (const k of newKeys) {
    if (flownKeys.has(k)) continue;
    if (isReveal) {
      // Real card replacing the placeholder that already flew: appear in place
      // (a second flight would look like it was drawn twice).
      flownKeys.add(k);
      continue;
    }
    flyPlan.set(k, state.drawnSource === "discard" ? "discard" : "stock");
  }
}

// Hide queued (not-yet-flown) cards in the freshly built fan so they don't
// flash in their final slot before flying.
function hideQueuedCards(fan) {
  if (prefersReducedMotion() || !flyPlan.size) return;
  flyPlan.forEach((_src, key) => {
    const el = fan.querySelector(`[data-card-key="${cssEscape(key)}"]`);
    if (el) el.style.opacity = "0";
  });
}

// Fly one card from `srcRect` into its own resting slot, spinning on the way.
function pitchEl(el, srcRect, { spin = 700, dur = 300, delay = 0, onDone } = {}) {
  const dst = el.getBoundingClientRect();
  if (!srcRect || !dst.width) {
    el.style.opacity = ""; // can't measure a source - just reveal it in place
    if (onDone) onDone();
    return;
  }
  const dx = srcRect.left + srcRect.width / 2 - (dst.left + dst.width / 2);
  const dy = srcRect.top + srcRect.height / 2 - (dst.top + dst.height / 2);
  const sc = Math.min(1, (srcRect.width || dst.width) / dst.width);
  el.style.willChange = "transform, opacity";
  el.style.opacity = "1";
  const anim = el.animate(
    [
      // Fully opaque from the very start so the card is clearly seen leaving the
      // deck (a faded-in start read as "appearing near the hand").
      {
        transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${sc})`,
        opacity: 1,
        offset: 0,
      },
      {
        transform: `translate(${dx * -0.05}px, ${dy * -0.05}px) rotate(-9deg) scale(1.06)`,
        opacity: 1,
        offset: 0.85,
      },
      { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1, offset: 1 },
    ],
    // An ease-in-out curve (vs a hard ease-out) keeps the whole path visible, so
    // the travel from the deck reads instead of blinking off the deck instantly.
    { duration: dur, delay, easing: "cubic-bezier(0.45, 0.05, 0.3, 1)", fill: "backwards" },
  );
  anim.onfinish = () => {
    el.style.willChange = "";
    el.style.opacity = "";
    if (onDone) onDone();
  };
}

// Re-armed on every render; fires once the re-render burst settles and flies
// everything still queued in flyPlan.
function scheduleHandPitch(root) {
  if (prefersReducedMotion() || !flyPlan.size) return;
  clearTimeout(pitchTimer);
  pitchTimer = setTimeout(() => runHandPitch(root), 80);
}
function runHandPitch(root) {
  const fan = root.querySelector(".hand-fan");
  if (!fan) return;
  const stockRect = rectOf(root.querySelector(".stock-pile .card-back"));
  const discardRect = rectOf(root.querySelector(".discard-pile"));
  const entries = [...flyPlan.entries()];
  const isDeal = entries.length > 1;
  let i = 0;
  for (const [key, srcName] of entries) {
    const el = fan.querySelector(`[data-card-key="${cssEscape(key)}"]`);
    if (!el) {
      // Card left the hand (melded/discarded) before it could fly - drop it.
      flyPlan.delete(key);
      flownKeys.add(key);
      continue;
    }
    const src = srcName === "discard" ? discardRect : stockRect;
    pitchEl(el, src, {
      spin: isDeal ? 720 : 640,
      dur: isDeal ? 430 : 380,
      delay: isDeal ? i * 34 : 0,
      onDone: () => {
        flyPlan.delete(key);
        if (key !== PENDING_KEY) flownKeys.add(key);
      },
    });
    i += 1;
  }
}

// Inline nav icons (currentColor). Music = note, SFX = speaker; the "off"
// variants add a slash. Home replaces the old "Lobby" label.
const NAV_ICONS = {
  musicOn:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
  musicOff:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 3l18 18"/></svg>',
  sfxOn:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16.5 8.5a5 5 0 0 1 0 7M19.5 6a8 8 0 0 1 0 12"/></svg>',
  sfxOff:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6M21 9l-5 6"/></svg>',
  invite:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 7.5l8 5.5 8-5.5"/></svg>',
  inviteDone:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" d="M4 11l8-7 8 7M6 10v9h5v-5h2v5h5v-9"/></svg>',
};

function selectedCards() {
  const { myCards, selectedCardKeys } = getState();
  return myCards.filter((c) => selectedCardKeys.has(cardKey(c)));
}

function isMyTurn(state) {
  return state.hand && state.hand.turnPlayerId === state.myPlayerId;
}

function isWildCard(card, wildRank) {
  return card.rank === "JOKER" || card.rank === wildRank;
}

// Turns a caught intent error into the message shown in the banner. When the
// server flagged that the same cards would form the OTHER meld type (couldBe),
// append a nudge toward the right button instead of leaving the player staring
// at a raw "must share a rank"-style validation error.
function errorText(e) {
  const msg = (e && e.message) || "Something went wrong";
  if (e && e.couldBe) {
    const other = e.couldBe === "RUN" ? "run" : "set";
    return `${msg} — but these cards would make a valid ${other}. Try “Meld as ${other}” instead.`;
  }
  return msg;
}

// A RUN meld/lay-off involving a wild card comes back from the server as
// { ok: false, needsWildDesignation: true, ... } instead of erroring or
// guessing - see propose-meld/layoff-card's edge functions. This opens the
// picker modal (see renderWildPickerModal) instead of treating it as either
// a success or a rejected move.
// Single "Meld" action. A group of cards can be a valid SET or a valid RUN
// but never both - a set is same-rank, a run is distinct consecutive ranks, so
// the same cards can't satisfy both. That means we don't need to ask the player
// which they meant: try SET, and if the server rejects it, try RUN (which opens
// the wild picker when a run's wilds need a designated rank).
async function meldAction(state) {
  const cards = selectedCards();
  if (cards.length < 3 || actionInFlight) return;
  setState({ error: null });
  actionInFlight = true;
  try {
    // Resolve the meld TYPE first: try SET, fall back to RUN. Only a rejected
    // proposal (the cards aren't that type) should trigger the fallback - so
    // applying the result is kept OUT of this block, otherwise a hiccup while
    // rendering a *successful* set would be misread as "not a set" and wrongly
    // retried as a run.
    let res;
    try {
      res = await proposeMeld(state.hand.id, cards, "SET");
    } catch (_notASet) {
      try {
        res = await proposeMeld(state.hand.id, cards, "RUN");
      } catch (_notARun) {
        setState({ error: "Those cards don\u2019t form a valid set or run." });
        return;
      }
    }
    // A run whose wilds need a designated rank: hand off to the picker.
    if (res.needsWildDesignation) {
      setState({
        wildPicker: { kind: "meld", handId: state.hand.id, cards, arrangements: res.arrangements },
      });
      return;
    }
    // Apply the (already-successful) meld; a view-processing error just falls
    // back to a fresh load rather than surfacing a bogus "invalid meld".
    try {
      await applyOrLoad(res, state.hand.id);
    } catch {
      await loadHand(state.hand.id).catch(() => {});
    }
    clearSelection();
  } finally {
    actionInFlight = false;
  }
}

async function proposeRun(state) {
  const cards = selectedCards();
  setState({ error: null });
  try {
    const result = await proposeMeld(state.hand.id, cards, "RUN");
    if (result.needsWildDesignation) {
      setState({
        wildPicker: {
          kind: "meld",
          handId: state.hand.id,
          cards,
          arrangements: result.arrangements,
        },
      });
      return;
    }
    if (result.view) applyHandView(result.view);
    else await loadHand(state.hand.id);
    clearSelection();
  } catch (e) {
    setState({ error: errorText(e) });
  }
}

async function stealWildAction(state, meldId, naturalCard) {
  setState({ error: null });
  try {
    const result = await stealWild(state.hand.id, meldId, naturalCard);
    if (result.view) applyHandView(result.view);
    else await loadHand(state.hand.id);
    clearSelection();
  } catch (e) {
    setState({ error: errorText(e) });
    await loadHand(state.hand.id).catch(() => {});
  }
}

async function unmeldMeld(state, meldId) {
  setState({ error: null });
  try {
    const result = await unmeld(state.hand.id, meldId);
    if (result.view) applyHandView(result.view);
    else await loadHand(state.hand.id);
  } catch (e) {
    setState({ error: errorText(e) });
  }
}

async function layOffOntoMeld(state, meldId) {
  const [card] = selectedCards();
  if (!card) {
    setState({
      error: "Select one card from your hand first, then click a meld to lay it off.",
    });
    return;
  }
  setState({ error: null });

  // Move the card onto the meld optimistically so it lands the instant you
  // click, instead of after a full server round trip - loadHand then
  // reconciles with the authoritative table, and on rejection restores it.
  // The one move we can't show yet is a wild joining a RUN: the server
  // replies needsWildDesignation (no move made) so we can open the rank
  // picker, and optimistically yanking the card would make it vanish while
  // that modal is up. isWildCard is inlined (the wild rank, or a joker).
  const meld = state.melds.find((m) => m.id === meldId);
  const isWild = card.rank === "JOKER" || card.rank === state.hand.wildRank;
  const willPrompt = meld?.meldType === "RUN" && isWild;
  if (!willPrompt) {
    setState((st) => ({
      myCards: st.myCards.filter((c) => cardKey(c) !== cardKey(card)),
      melds: st.melds.map((m) => (m.id === meldId ? { ...m, cards: [...m.cards, card] } : m)),
    }));
  }

  try {
    const result = await layOffCard(state.hand.id, card, meldId);
    if (result.needsWildDesignation) {
      setState({
        wildPicker: {
          kind: "layoff",
          handId: state.hand.id,
          card,
          meldId,
          candidateRanks: result.candidateRanks,
        },
      });
      return;
    }
    if (result.view) applyHandView(result.view);
    else await loadHand(state.hand.id);
    clearSelection();
  } catch (e) {
    setState({ error: errorText(e) });
    // Undo the optimistic move by refetching the true table state.
    await loadHand(state.hand.id).catch(() => {});
  }
}

/**
 * Submits the player's choice from the wild-designation picker: for a meld,
 * pairs each wild card (in hand-selection order) with the chosen
 * arrangement's wild ranks (ascending) - which physical wild gets which
 * rank doesn't matter to the server, only that the multiset matches (see
 * validateWildAssignments), and sortRunCards places each card correctly by
 * its own assigned rank regardless of that pairing.
 */
async function submitWildPicker(picker, choice) {
  // Close the picker up front and, for a lay-off, drop the card onto the meld
  // optimistically now that we know the rank it takes (choice) - same instant
  // feedback as an ordinary lay-off. loadHand reconciles / restores after.
  setState({ error: null, wildPicker: null });
  if (picker.kind === "layoff") {
    setState((st) => ({
      myCards: st.myCards.filter((c) => cardKey(c) !== cardKey(picker.card)),
      melds: st.melds.map((m) =>
        m.id === picker.meldId
          ? { ...m, cards: [...m.cards, { ...picker.card, wildAs: choice }] }
          : m,
      ),
    }));
  }
  try {
    let result;
    if (picker.kind === "meld") {
      // The chosen arrangement carries the exact cardKey -> rank map for its
      // wild fillers; a wild-rank card acting as its own natural is left out.
      result = await proposeMeld(picker.handId, picker.cards, "RUN", choice.wildAssignments);
    } else {
      result = await layOffCard(picker.handId, picker.card, picker.meldId, choice);
    }
    if (result.view) applyHandView(result.view);
    else await loadHand(picker.handId);
    clearSelection();
  } catch (e) {
    setState({ error: errorText(e) });
    await loadHand(picker.handId).catch(() => {});
  }
}

// Realtime eventually tells every other player about a successful action,
// but the player who just took the action shouldn't have to wait on a
// round trip through Postgres Changes to see their own move reflected -
// and if realtime is ever slow, down, or misconfigured, an unrefreshed
// screen looks exactly like "nothing happened", which invites exactly the
// kind of repeated re-clicking that causes duplicate actions. So every
// guarded call refreshes this client's own state directly after success.
//
// Clearing the error up front (rather than only on success) means a stale
// message from a previous failed attempt disappears the moment the player
// tries anything else, instead of sitting on screen indefinitely - it
// used to only clear if the player clicked the banner itself, so it could
// linger through several successful actions afterward.
// A single action is allowed in flight at a time, so a laggy round trip can't
// be fired twice by an impatient re-click.
let actionInFlight = false;
async function guard(fn, refresh, optimistic) {
  if (actionInFlight) return;
  actionInFlight = true;
  setState({ error: null });
  // Show the move immediately (optimistic), before the server round trip, so
  // the click never *looks* like nothing happened. `refresh` then reconciles
  // with the authoritative server state - and if the move is rejected, that
  // same refresh restores the truth, undoing the optimistic change.
  if (optimistic) setState(optimistic);
  try {
    const result = await fn();
    // A successful action returns the acting player's viewer-scoped snapshot
    // (see applyOrLoad) - apply it instead of a second read round trip.
    if (refresh) await refresh(result);
  } catch (e) {
    setState({ error: errorText(e) });
    // No view on the error path - fall back to reloading the true state.
    if (refresh) await refresh().catch(() => {});
  } finally {
    actionInFlight = false;
  }
}

// The edge functions return { ok: true, view } where view is exactly what this
// player may see (loadHand's shape, RLS gating already applied server-side).
// Applying it skips the second read; we still fall back to loadHand when there
// is no view (older function, or the error path restoring the truth).
async function applyOrLoad(result, handId) {
  if (result && result.view) applyHandView(result.view);
  else await loadHand(handId);
}
function reconcile(state) {
  return (result) => applyOrLoad(result, state.hand.id);
}

// A labeled column wrapper for a pile (Stock / Discard) in the center row.
function makePile(label) {
  const col = document.createElement("div");
  col.className = "pile";
  const lab = document.createElement("div");
  lab.className = "pile-label";
  lab.textContent = label;
  col.appendChild(lab);
  return col;
}

// Drawing a card has two entry points: the labeled buttons in the control
// bar and a direct click on the pile graphics (the stock deck / the top of
// the discard pile - see renderTable). Both route through these so the
// optimistic update and refresh are identical no matter which one is used.
function drawStockAction(state) {
  return guard(
    () => drawStock(state.hand.id),
    reconcile(state),
    // The drawn card comes from the face-down stock, so we can't know it yet
    // - but flipping hasDrawn instantly disables the draw affordances and
    // lights up meld/discard, and the card itself pops in on refresh.
    (st) => ({
      hand: { ...st.hand, hasDrawnThisTurn: true },
      drawnSource: "stock",
      // Face-down card: we can't show the real one yet, so land an inert
      // placeholder immediately (renderTable) so the pickup feels instant.
      pendingDraw: true,
    }),
  );
}

function drawDiscardAction(state) {
  return guard(
    () => drawDiscard(state.hand.id),
    reconcile(state),
    (st) => {
      const [top, ...rest] = st.hand.discardPile;
      return {
        hand: { ...st.hand, hasDrawnThisTurn: true, discardPile: rest },
        myCards: top ? [...st.myCards, top] : st.myCards,
        drawnSource: "discard",
      };
    },
  );
}

// Players are laid out in two columns that zigzag down the page: player 1 in
// the top-left, player 2 top-right, player 3 left, player 4 right, and so on
// (seat order, so every client sees the same arrangement). Avatars are large;
// the active player's avatar blinks (see .player-card--active in style.css).
function renderPlayerColumns(root, state) {
  const players = state.players;
  if (!players.length) return;

  const grid = document.createElement("div");
  grid.className = "player-grid";
  const leftCol = document.createElement("div");
  leftCol.className = "player-col player-col--left";
  const rightCol = document.createElement("div");
  rightCol.className = "player-col player-col--right";

  players.forEach((player, i) => {
    const card = document.createElement("div");
    card.className = "player-card";
    if (player.id === state.myPlayerId) card.classList.add("player-card--self");
    if (state.hand?.turnPlayerId === player.id) card.classList.add("player-card--active");
    if (player.id === state.hand?.payMeCallerId) card.classList.add("player-card--pay-me");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const avSrc = avatarSrc(player.avatar);
    if (avSrc) {
      avatar.classList.add("avatar--img");
      const img = document.createElement("img");
      img.src = avSrc;
      img.alt = player.displayName;
      avatar.appendChild(img);
    } else {
      avatar.textContent = player.displayName.slice(0, 2).toUpperCase();
    }
    if (!player.connected) avatar.classList.add("avatar--disconnected");

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "avatar-wrap";
    avatarWrap.appendChild(avatar);
    card.appendChild(avatarWrap);

    const name = document.createElement("div");
    name.className = "seat-name";
    name.textContent = player.displayName;
    card.appendChild(name);

    (i % 2 === 0 ? leftCol : rightCol).appendChild(card);
  });

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  root.appendChild(grid);
}

function renderMelds(root, state) {
  const section = document.createElement("div");
  section.className = "melds";
  // Pay Me hasn't been declared yet - melds are still private (each
  // player's own melds only, per RLS - see supabase/migrations), and the
  // owner can still change their mind and take one back.
  const canUnmeld = !state.hand?.payMeCallerId;
  const hasSelection = state.selectedCardKeys.size >= 1;
  const inLayoff = state.hand?.phase === "layoff";
  const myLayoffTurn = inLayoff && state.hand?.pendingLayoffs[0] === state.myPlayerId;
  const wildRank = state.hand?.wildRank;
  for (const meld of state.melds) {
    // Valid lay-off target only per phase (own melds in play; ONLY the winner's
    // meld in the lay-off round) - see layTargetOk.
    const layable = layTargetOk(state, meld);
    const meldEl = document.createElement("div");
    meldEl.className =
      "meld" + (layable ? " meld--layable" : "") + (layable && hasSelection ? " meld--target" : "");
    meldEl.dataset.meldId = meld.id;
    // Newly formed meld -> one reward glow-pulse (see .anim-meld-in).
    if (!prevMeldIds.has(meld.id)) meldEl.classList.add("anim-meld-in");
    // A wild-rank card shows its normal suit color when it's acting as a
    // NATURAL (a set OF the wild rank), and the wild color when it's a filler
    // or a designated wild (runs carry a wildAs on their wilds). Jokers are
    // always wild. This mirrors validateSet's "set of the wild rank" rule.
    const setOfWildRank =
      meld.meldType === "SET" && !meld.cards.some((c) => c.rank !== "JOKER" && c.rank !== wildRank);
    // Winner's run during your lay-off turn: a wild you hold the exact natural
    // for (same rank AND suit) can be stolen - see stealWildAction / steal-wild.
    const stealableRun =
      myLayoffTurn && meld.meldType === "RUN" && meld.ownerPlayerId === state.hand?.payMeCallerId;
    const runSuit = stealableRun
      ? (meld.cards.find((c) => c.wildAs == null && c.rank !== "JOKER")?.suit ?? null)
      : null;
    for (const card of meld.cards) {
      const actingWild =
        card.rank === "JOKER" ||
        (card.rank === wildRank &&
          (meld.meldType === "SET" ? !setOfWildRank : card.wildAs != null));
      meldEl.appendChild(renderCard(card, { wild: actingWild }));
      if (stealableRun && card.wildAs != null) {
        const nat = state.myCards.find(
          (mc) =>
            mc.rank === card.wildAs &&
            mc.suit === runSuit &&
            !(mc.rank === "JOKER" || mc.rank === wildRank),
        );
        if (nat) {
          const stealBtn = document.createElement("button");
          stealBtn.type = "button";
          stealBtn.className = "btn btn--secondary steal-btn";
          const sym = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" }[nat.suit] ?? "";
          stealBtn.textContent = `Steal (play ${nat.rank}${sym})`;
          stealBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            stealWildAction(state, meld.id, nat);
          });
          meldEl.appendChild(stealBtn);
        }
      }
    }
    if (layable) {
      const cue = document.createElement("div");
      cue.className = "meld-layoff-cue";
      cue.textContent = hasSelection ? "Tap to lay off here" : "Select a card, then tap";
      meldEl.appendChild(cue);
    }
    if (canUnmeld && meld.ownerPlayerId === state.myPlayerId) {
      const unmeldBtn = document.createElement("button");
      unmeldBtn.type = "button";
      unmeldBtn.className = "btn btn--secondary unmeld-btn";
      unmeldBtn.textContent = "Unmeld";
      unmeldBtn.addEventListener("click", (e) => {
        // Otherwise this bubbles up to meldEl's own click listener below,
        // which would try to lay a selected card off onto this meld instead.
        e.stopPropagation();
        unmeldMeld(state, meld.id);
      });
      meldEl.appendChild(unmeldBtn);
    }
    if (layable) {
      meldEl.addEventListener("click", () => layOffOntoMeld(state, meld.id));
    }
    section.appendChild(meldEl);
  }
  prevMeldIds = new Set(state.melds.map((m) => m.id));
  root.appendChild(section);
}

// The discard-pile history viewer (memory aid). Shows every card currently in
// the discard pile, newest first, as inert view-only cards - the newest (the
// real top card) is ringed. Note it reflects the *current* pile, so cards a
// player has drawn back out are no longer listed (they left the pile).
function renderDiscardLogModal(root, state) {
  if (!state.showDiscardLog) return;
  const pile = state.hand?.discardPile ?? [];

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) setState({ showDiscardLog: false });
  });

  const card = document.createElement("div");
  card.className = "modal-card";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "Discard pile";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "modal-subtitle";
  subtitle.textContent = pile.length
    ? `${pile.length} card${pile.length === 1 ? "" : "s"} in the pile`
    : "The discard pile is empty";
  card.appendChild(subtitle);

  // Explicit direction labels so the left-to-right strip unmistakably reads
  // newest -> oldest (reinforced by the recency fade below).
  if (pile.length) {
    const legend = document.createElement("div");
    legend.className = "discard-log-legend";
    const recent = document.createElement("span");
    recent.textContent = "Most recent";
    const oldest = document.createElement("span");
    oldest.textContent = "Oldest";
    legend.appendChild(recent);
    legend.appendChild(oldest);
    card.appendChild(legend);
  }

  const grid = document.createElement("div");
  grid.className = "discard-log";
  pile.forEach((c, i) => {
    const cardEl = renderCard(c, { wild: isWildCard(c, state.hand?.wildRank), tabIndex: -1 });
    cardEl.classList.add("discard-log-card");
    if (i === 0) cardEl.classList.add("discard-log-card--top");
    // Recency fade: the newest card is fully lit and each older card recedes
    // a little, so the strip reads as a time gradient. Floored at 0.6 so even
    // the oldest card stays legible.
    const t = pile.length > 1 ? i / (pile.length - 1) : 0;
    cardEl.style.opacity = (1 - 0.4 * t).toFixed(3);
    grid.appendChild(cardEl);
  });
  card.appendChild(grid);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn--primary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => setState({ showDiscardLog: false }));
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  root.appendChild(overlay);
}

function renderStandingsModal(root, state) {
  if (!state.showStandings) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  // Clicking the dimmed backdrop (not the card itself) closes it, same as
  // any standard modal - clicking inside the card must not bubble here.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) setState({ showStandings: false });
  });

  const card = document.createElement("div");
  card.className = "modal-card";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "Scores";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "modal-subtitle";
  subtitle.textContent =
    state.standingsHandsPlayed === 0
      ? "No hands completed yet"
      : `Lower score is better · ${state.standingsHandsPlayed} hand${
          state.standingsHandsPlayed === 1 ? "" : "s"
        } played`;
  card.appendChild(subtitle);

  const table = document.createElement("div");
  table.className = "standings-table";
  for (const entry of state.standings) {
    const row = document.createElement("div");
    row.className = "standings-row";

    const name = document.createElement("span");
    name.className = "standings-name";
    name.textContent = entry.displayName;
    row.appendChild(name);

    // Always render this slot, even empty - it's a fixed-width grid column
    // (see CSS) so every row's badge and score line up in neat columns
    // instead of the score shifting left/right depending on whether that
    // particular row happens to have a badge.
    const badgeSlot = document.createElement("span");
    badgeSlot.className = "standings-badge-slot";
    if (entry.payMeWins > 0) {
      const badge = document.createElement("span");
      badge.className = "badge-payme";
      badge.textContent = `★ ${entry.payMeWins}`;
      badge.title = `${entry.payMeWins} Pay Me call${entry.payMeWins === 1 ? "" : "s"}`;
      badgeSlot.appendChild(badge);
    }
    row.appendChild(badgeSlot);

    const score = document.createElement("span");
    score.className = "standings-score";
    score.textContent = String(entry.cumulativeScore);
    row.appendChild(score);

    table.appendChild(row);
  }
  card.appendChild(table);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn--primary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => setState({ showStandings: false }));
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  root.appendChild(overlay);
}

function renderWildPickerModal(root, state) {
  const picker = state.wildPicker;
  if (!picker) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "What's the wild card?";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "modal-subtitle";
  subtitle.textContent =
    picker.kind === "meld"
      ? "This run has more than one way to complete it - pick which one."
      : "Which end of the run is this card extending?";
  card.appendChild(subtitle);

  const options = document.createElement("div");
  options.className = "wild-picker-options";

  if (picker.kind === "meld") {
    for (const arrangement of picker.arrangements) {
      const btn = document.createElement("button");
      btn.className = "btn btn--primary";
      btn.textContent = arrangement.orderedRanks.join(", ");
      btn.addEventListener("click", () => submitWildPicker(picker, arrangement));
      options.appendChild(btn);
    }
  } else {
    for (const rank of picker.candidateRanks) {
      const btn = document.createElement("button");
      btn.className = "btn btn--primary";
      btn.textContent = rank;
      btn.addEventListener("click", () => submitWildPicker(picker, rank));
      options.appendChild(btn);
    }
  }
  card.appendChild(options);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => setState({ wildPicker: null }));
  card.appendChild(cancelBtn);

  overlay.appendChild(card);
  root.appendChild(overlay);
}

function renderPayMeBanner(root, state) {
  if (!state.hand?.payMeCallerId) return;
  const caller = state.players.find((p) => p.id === state.hand.payMeCallerId);
  const banner = document.createElement("div");
  banner.className = "pay-me-banner";
  banner.textContent = `${caller ? caller.displayName : "A player"} called Pay Me!`;
  root.appendChild(banner);
}

// Whether the player can lay a card off onto a meld right now: on their own
// turn after drawing (onto their own melds), or during their lay-off turn
// (onto any meld). Used to signpost the otherwise-hidden "tap a card, then
// tap a meld" interaction, which has no button of its own.
function canLayOffNow(state) {
  if (!state.hand || state.melds.length === 0) return false;
  const inLayoff = state.hand.phase === "layoff";
  const myLayoffTurn = inLayoff && state.hand.pendingLayoffs[0] === state.myPlayerId;
  const myPlayTurn = isMyTurn(state) && state.hand.hasDrawnThisTurn && !inLayoff;
  return myPlayTurn || myLayoffTurn;
}

// Which melds are valid lay-off targets right now:
//  - during your normal turn: only your OWN melds.
//  - during your lay-off turn: only the winner's (Pay Me caller's) meld.
function layTargetOk(state, meld) {
  if (!state.hand) return false;
  const inLayoff = state.hand.phase === "layoff";
  const myLayoffTurn = inLayoff && state.hand.pendingLayoffs[0] === state.myPlayerId;
  const myPlayTurn = isMyTurn(state) && state.hand.hasDrawnThisTurn && !inLayoff;
  if (myLayoffTurn) return meld.ownerPlayerId === state.hand.payMeCallerId;
  if (myPlayTurn) return meld.ownerPlayerId === state.myPlayerId;
  return false;
}

// A one-line, touch-friendly explanation of what the player can do right now -
// so a greyed-out Meld button (or the buttonless lay-off) isn't a mystery.
function buildActionHint(state, myTurn, inLayoff, myLayoffTurn) {
  let text = "";
  if (myLayoffTurn) {
    text = state.melds.length
      ? "Lay-off round (no discarding now): tap a card, then a meld, to lay it off. Any card you can't lay off stays in your hand - tap Pass when you're done."
      : "Lay-off round: nothing here to lay off onto, so tap Pass. Any cards left stay in your hand.";
  } else if (myTurn && !state.hand.hasDrawnThisTurn) {
    text =
      "Your turn - draw a card by tapping the stock or discard pile, then meld, lay off, or discard.";
  } else if (myTurn && state.hand.hasDrawnThisTurn) {
    const parts = [
      selectedCards().length >= 3 ? "Meld the selected cards" : "select 3+ cards to Meld",
    ];
    if (state.melds.length) parts.push("tap a card then a meld to lay it off");
    parts.push("or discard one card to end your turn");
    text = parts.join(" \u00b7 ");
  } else {
    // Not this player's turn: name who everyone's waiting on, so the moment
    // never reads as a dead/unclear screen (the seat glow alone is easy to
    // miss). Covers normal turns and the lay-off round.
    const waitingOn = state.players.find((p) => p.id === state.hand.turnPlayerId);
    if (waitingOn && waitingOn.id !== state.myPlayerId) {
      text = `Waiting for ${waitingOn.displayName} to ${inLayoff ? "lay off" : "play"}\u2026`;
    }
  }
  if (!text) return null;
  const hint = document.createElement("div");
  hint.className = "action-hint";
  hint.textContent = text;
  return hint;
}

// Why the Meld buttons are disabled (shown as a hover tooltip on desktop).
function meldDisabledReason(state, myTurn, inLayoff, myLayoffTurn) {
  if (!myTurn && !myLayoffTurn) return "Wait for your turn";
  if (myTurn && !inLayoff && !state.hand.hasDrawnThisTurn) return "Draw a card first";
  if (selectedCards().length < 3) return "Select at least 3 cards";
  return "";
}

function renderControls(root, state) {
  const bar = document.createElement("div");
  bar.className = "controls";

  const noActiveHand = !state.hand || state.hand.phase === "complete";
  if (noActiveHand && state.room) {
    // The hand that just finished still has its (already-loaded)
    // publicHandInfo scores sitting in state - show them here instead of
    // silently jumping straight to "deal the next one" with no recap.
    if (state.hand?.phase === "complete" && state.publicHandInfo.length) {
      const summary = document.createElement("div");
      summary.className = "hand-score-summary";

      const title = document.createElement("div");
      title.className = "hand-score-summary-title";
      title.textContent = `Hand ${state.hand.handNumber} scores`;
      summary.appendChild(title);

      for (const info of state.publicHandInfo) {
        const player = state.players.find((p) => p.id === info.playerId);
        const isCaller = info.playerId === state.hand.payMeCallerId;
        const row = document.createElement("div");
        row.className = "hand-score-row" + (isCaller ? " hand-score-row--caller" : "");

        const name = document.createElement("span");
        name.className = "hand-score-row-name";
        name.textContent = player?.displayName ?? "?";
        row.appendChild(name);

        // Fixed-width slot (see CSS) so the score column lines up whether
        // or not this row has a badge, same as the standings modal.
        const badgeSlot = document.createElement("span");
        badgeSlot.className = "standings-badge-slot";
        if (isCaller) {
          const badge = document.createElement("span");
          badge.className = "badge-payme";
          badge.textContent = "Pay Me";
          badgeSlot.appendChild(badge);
        }
        row.appendChild(badgeSlot);

        const score = document.createElement("span");
        score.className = "hand-score-row-score";
        score.textContent = String(info.score ?? 0);
        row.appendChild(score);

        summary.appendChild(row);
      }
      bar.appendChild(summary);
    }

    const label = state.room.currentHandNumber === 0 ? "Deal hand 1" : "Deal next hand";
    const btn = document.createElement("button");
    btn.className = "btn btn--primary";
    const totalHands = state.room.totalHands ?? 11;
    btn.textContent = state.room.currentHandNumber >= totalHands ? "Game complete" : label;
    btn.disabled = state.room.currentHandNumber >= totalHands || state.players.length < 2;
    btn.addEventListener("click", () => {
      // Belt-and-suspenders against double-fires: disable immediately so a
      // second click (or a slow network making the first click look like
      // it did nothing) can't send a second start-hand before this one's
      // refresh lands and re-renders the button away.
      btn.disabled = true;
      guard(
        () => startHand(state.room.id),
        () => loadRoom(state.room.id),
      );
    });
    bar.appendChild(btn);
    root.appendChild(bar);
    return;
  }

  if (!state.hand) {
    root.appendChild(bar);
    return;
  }

  const myTurn = isMyTurn(state);
  const inLayoff = state.hand.phase === "layoff";
  const myLayoffTurn = inLayoff && state.hand.pendingLayoffs[0] === state.myPlayerId;

  // Draw is done by tapping the stock or discard pile directly (see
  // renderTable) - no separate draw buttons.
  //
  // The layoff phase never involves drawing (it's a card-dump round after
  // everyone's had their real final turn), so hasDrawnThisTurn never becomes
  // true there - gating melding on it would leave these buttons permanently
  // disabled for the rest of the hand. myLayoffTurn stands in for "allowed
  // to act right now" in that phase instead.
  const canMeld = myTurn && (state.hand.hasDrawnThisTurn || myLayoffTurn);

  const meldBtn = document.createElement("button");
  meldBtn.className = "btn";
  meldBtn.textContent = "Meld";
  meldBtn.disabled = !canMeld || selectedCards().length < 3;
  if (meldBtn.disabled) meldBtn.title = meldDisabledReason(state, myTurn, inLayoff, myLayoffTurn);
  meldBtn.addEventListener("click", () => meldAction(state));
  bar.appendChild(meldBtn);

  const discardBtn = document.createElement("button");
  discardBtn.className = "btn btn--primary";
  discardBtn.textContent = "Discard selected";
  discardBtn.disabled =
    inLayoff || !myTurn || !state.hand.hasDrawnThisTurn || selectedCards().length !== 1;
  discardBtn.addEventListener("click", () => {
    const card = selectedCards()[0];
    guard(
      () => discardCard(state.hand.id, card),
      reconcile(state),
      (st) => ({
        hand: { ...st.hand, discardPile: [card, ...st.hand.discardPile] },
        myCards: st.myCards.filter((c) => cardKey(c) !== cardKey(card)),
      }),
    ).then(clearSelection);
  });
  bar.appendChild(discardBtn);

  if (myLayoffTurn) {
    const passBtn = document.createElement("button");
    passBtn.className = "btn btn--primary";
    passBtn.textContent = "Pass (done laying off)";
    passBtn.addEventListener("click", () =>
      guard(() => passLayoff(state.hand.id), reconcile(state)),
    );
    bar.appendChild(passBtn);
  }

  const hint = buildActionHint(state, myTurn, inLayoff, myLayoffTurn);
  if (hint) bar.appendChild(hint);

  root.appendChild(bar);
}

export function renderTable(root) {
  const state = getState();
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "table-screen";

  // On mobile the table becomes a fixed app-shell: the board (header,
  // opponents, piles, melds) scrolls inside `board`, while the player's hand
  // and action buttons live in `dock`, pinned to the bottom so they never
  // scroll out of reach (see the <=640 rules in style.css). On desktop both
  // are plain blocks, so the stacked layout is unchanged.
  const board = document.createElement("div");
  board.className = "board-scroll";
  const dock = document.createElement("div");
  dock.className = "player-dock";

  const header = document.createElement("div");
  header.className = "table-header";
  // Top line: room code on the left; the action icons get appended to the
  // right of this same row further down.
  const topbar = document.createElement("div");
  topbar.className = "topbar-row";
  topbar.innerHTML = `<div class="room-code">Room: <span class="room-code-value">${state.room?.code ?? ""}</span></div>`;
  header.appendChild(topbar);
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";

  const scoresBtn = document.createElement("button");
  scoresBtn.className = "btn scores-btn";
  scoresBtn.textContent = "Scores";
  // Always available, in every phase - not gated on a hand being in
  // progress - so it works as a standings reference at any point, not
  // just once a game has started.
  scoresBtn.addEventListener("click", async () => {
    if (state.room) await loadStandings(state.room.id);
    setState({ showStandings: true });
  });

  // Audio prefs aren't part of the shared game state (they're a purely
  // local, per-browser preference - see audioManager.js), so toggling
  // them updates these two buttons directly instead of going through
  // setState/a full re-render.
  const musicBtn = document.createElement("button");
  musicBtn.type = "button";
  musicBtn.className = "btn audio-toggle-btn icon-btn";
  const syncMusicBtn = () => {
    const on = isMusicEnabled();
    musicBtn.innerHTML = on ? NAV_ICONS.musicOn : NAV_ICONS.musicOff;
    const label = on ? "Music on" : "Music off";
    musicBtn.setAttribute("aria-label", label);
    musicBtn.title = label;
    musicBtn.classList.toggle("audio-toggle-btn--off", !on);
  };
  syncMusicBtn();
  musicBtn.addEventListener("click", () => {
    toggleMusic();
    syncMusicBtn();
  });
  headerActions.appendChild(musicBtn);

  const sfxBtn = document.createElement("button");
  sfxBtn.type = "button";
  sfxBtn.className = "btn audio-toggle-btn icon-btn";
  const syncSfxBtn = () => {
    const on = isSfxEnabled();
    sfxBtn.innerHTML = on ? NAV_ICONS.sfxOn : NAV_ICONS.sfxOff;
    const label = on ? "Sound effects on" : "Sound effects off";
    sfxBtn.setAttribute("aria-label", label);
    sfxBtn.title = label;
    sfxBtn.classList.toggle("audio-toggle-btn--off", !on);
  };
  syncSfxBtn();
  sfxBtn.addEventListener("click", () => {
    toggleSfx();
    syncSfxBtn();
  });
  headerActions.appendChild(sfxBtn);

  // Copy a shareable invite link (the room's ?room=CODE URL). Updates its own
  // label on click rather than going through setState, so a re-render can't
  // wipe the transient "Copied!" mid-timeout (same pattern as the audio btns).
  if (state.room?.code) {
    const inviteBtn = document.createElement("button");
    inviteBtn.type = "button";
    inviteBtn.className = "btn invite-btn icon-btn";
    inviteBtn.innerHTML = NAV_ICONS.invite;
    inviteBtn.title = "Invite - copy link";
    inviteBtn.setAttribute("aria-label", "Invite - copy link");
    inviteBtn.addEventListener("click", async () => {
      const link = inviteLink(state.room.code);
      try {
        await navigator.clipboard.writeText(link);
        inviteBtn.innerHTML = NAV_ICONS.inviteDone;
        inviteBtn.classList.add("invite-btn--done");
        inviteBtn.title = "Link copied!";
      } catch {
        window.prompt("Copy this invite link:", link);
      }
      setTimeout(() => {
        inviteBtn.innerHTML = NAV_ICONS.invite;
        inviteBtn.classList.remove("invite-btn--done");
        inviteBtn.title = "Invite - copy link";
      }, 1600);
    });
    headerActions.appendChild(inviteBtn);
  }

  // Back to the lobby. Since a refresh now reconnects to the current room
  // (see reconnect.js), this is the way to leave a table to start/join a
  // different game. Local navigation only - the player stays a member
  // server-side and can rejoin with the code (or a refresh reconnects them
  // until they join another game).
  if (state.room) {
    const lobbyBtn = document.createElement("button");
    lobbyBtn.type = "button";
    lobbyBtn.className = "btn home-btn icon-btn";
    lobbyBtn.innerHTML = NAV_ICONS.home;
    lobbyBtn.title = "Home";
    lobbyBtn.setAttribute("aria-label", "Home - leave this table");
    lobbyBtn.addEventListener("click", () => {
      if (!confirm("Leave this table and go Home? You can rejoin with its room code.")) return;
      clearPersistedRoom();
      setRoomInUrl(null);
      setState({
        screen: "lobby",
        room: null,
        hand: null,
        myPlayerId: null,
        myCards: [],
        melds: [],
        publicHandInfo: [],
        players: [],
        selectedCardKeys: new Set(),
        showStandings: false,
        showDiscardLog: false,
      });
    });
    headerActions.appendChild(lobbyBtn);
  }

  headerActions.appendChild(scoresBtn);

  // Icons live in the top-right corner of the top line.
  topbar.appendChild(headerActions);

  // Hand number + wild rank: on their own line, centered under the top line.
  const handInfo = document.createElement("div");
  handInfo.className = "hand-info hand-info--center";
  handInfo.innerHTML = state.hand
    ? `Hand ${state.hand.handNumber}/${state.room?.totalHands ?? 11} &middot; wild: ${state.hand.wildRank}`
    : "Waiting to deal";
  header.appendChild(handInfo);

  wrap.appendChild(header);

  if (state.hand?.phase !== "complete") renderPayMeBanner(board, state);

  // No table surface anymore: players zigzag down the left/right edges just
  // under the header; the piles are centered below them.
  renderPlayerColumns(board, state);

  if (state.hand) {
    // A finished hand shows a clean recap (opponents + revealed melds + the
    // per-hand score tally from renderControls). Skip the draw piles then:
    // there's nothing left to draw, and they'd otherwise push the tally off
    // the bottom of the screen.
    if (state.hand.phase !== "complete") {
      const centerRow = document.createElement("div");
      centerRow.className = "center-row center-piles";

      // A draw (from either pile) is only legal on your own turn, before
      // you've drawn, and never in the layoff phase - the same gate the draw
      // buttons use. The piles are always shown; the top card just isn't
      // clickable when it isn't a legal draw.
      const canDraw =
        isMyTurn(state) && !state.hand.hasDrawnThisTurn && state.hand.phase !== "layoff";

      // Stock pile: a single face-down "Pay Me" card (the draw target). It used
      // to show a couple of static backs behind it for depth; now it's a clean
      // single layer.
      const stockCol = makePile("Stock");
      const stockStack = document.createElement("div");
      stockStack.className = "stock-pile stock-pile--single";
      stockStack.appendChild(
        renderCardBack({
          interactive: true,
          disabled: !canDraw,
          ariaLabel: "Draw from stock",
          onClick: () => drawStockAction(state),
        }),
      );
      stockCol.appendChild(stockStack);
      centerRow.appendChild(stockCol);

      // Discard pile: top card is clickable to pick up (same as the button).
      const discardCol = makePile("Discard");
      const discardPileEl = document.createElement("div");
      discardPileEl.className = "discard-pile";
      const topTwo = state.hand.discardPile.slice(0, 2).reverse();
      topTwo.forEach((card, i) => {
        const isTop = i === topTwo.length - 1;
        const cardEl = renderCard(card, {
          tabIndex: isTop && canDraw ? 0 : -1,
          onClick: isTop && canDraw ? () => drawDiscardAction(state) : undefined,
        });
        if (isTop && canDraw) cardEl.classList.add("card--drawable");
        discardPileEl.appendChild(cardEl);
      });
      if (topTwo.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pile-empty";
        discardPileEl.appendChild(empty);
      }
      // Long-press the discard pile to open its full history (replaces the
      // old "See all" button). Press-and-hold ~450ms opens the viewer; a
      // normal tap still draws when it's a legal draw.
      if (state.hand.discardPile.length > 0) {
        discardPileEl.title = "Press and hold to view the discard pile";
        let pressTimer = null;
        let longPressed = false;
        const startPress = () => {
          longPressed = false;
          pressTimer = setTimeout(() => {
            longPressed = true;
            setState({ showDiscardLog: true });
          }, 450);
        };
        const endPress = () => clearTimeout(pressTimer);
        discardPileEl.addEventListener("pointerdown", startPress);
        discardPileEl.addEventListener("pointerup", endPress);
        discardPileEl.addEventListener("pointerleave", endPress);
        discardPileEl.addEventListener("pointercancel", endPress);
        discardPileEl.addEventListener("contextmenu", (e) => e.preventDefault());
        // Swallow the draw click that would otherwise follow a long press.
        discardPileEl.addEventListener(
          "click",
          (e) => {
            if (longPressed) {
              e.stopPropagation();
              e.preventDefault();
              longPressed = false;
            }
          },
          true,
        );
      }
      discardCol.appendChild(discardPileEl);
      centerRow.appendChild(discardCol);

      board.appendChild(centerRow);
    }
    renderMelds(board, state);
  }

  if (state.myCards.length) {
    const handLabel = document.createElement("div");
    handLabel.className = "hand-label";
    handLabel.textContent = "Your hand";
    dock.appendChild(handLabel);

    // Card order in hand is a private, local-only preference (see
    // ui/handOrder.js) - drag to rearrange, or one-tap auto-sort. None of it
    // touches game state, so it's committed straight to local state + storage.
    const setOrder = (cards) => {
      commitOrder(state.hand?.id, cards);
      setState({ myCards: cards });
    };

    if (state.myCards.length > 1) {
      const sortBar = document.createElement("div");
      sortBar.className = "hand-sort";
      const mkSort = (label, sortFn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn hand-sort-btn";
        b.textContent = label;
        b.addEventListener("click", () => setOrder(sortFn(state.myCards, state.hand?.wildRank)));
        return b;
      };
      sortBar.appendChild(mkSort("Sort by rank", sortByRank));
      sortBar.appendChild(mkSort("Sort by suit", sortBySuit));
      dock.appendChild(sortBar);
    }

    // Only cards not present on the previous render get the deal-in
    // animation, so selection toggles / opponents' moves don't re-animate
    // the whole hand. (First render after joining deals the hand in.)
    const curKeys = state.myCards.map((c) => cardKey(c));
    const newKeys = new Set(curKeys.filter((k) => !prevHandKeys.has(k)));
    prevHandKeys = new Set(curKeys);
    // Plan the dealer-pitch flight for any new cards (deal or pickup) before we
    // build the fan, so queued cards can be hidden until they actually fly.
    planHandPitch(state, newKeys);
    const fan = renderCardFan(state.myCards, {
      selectedKeys: state.selectedCardKeys,
      wildRank: state.hand?.wildRank,
      onClick: (card) => toggleCardSelection(card),
      newKeys,
    });
    makeHandFanDraggable(fan, (keys) => {
      const byKey = new Map(state.myCards.map((c) => [cardKey(c), c]));
      const reordered = keys.map((k) => byKey.get(k)).filter(Boolean);
      // Guard against a torn drag (e.g. a realtime re-render mid-drag): only
      // commit when we still have exactly the same set of cards, reordered.
      if (reordered.length === state.myCards.length) setOrder(reordered);
    });
    // Optimistic stock-draw placeholder: a face-down card shown the instant you
    // draw (the real card is unknown until the server replies, then swaps in).
    // It's what flies out of the deck so the click feels immediate.
    if (state.pendingDraw) {
      const pending = renderCardBack({ ariaLabel: "Drawing a card" });
      pending.classList.add("card-pending");
      pending.style.animation = "none"; // the flight provides the motion
      pending.dataset.cardKey = PENDING_KEY;
      fan.appendChild(pending);
    }
    // Keep queued-to-fly cards invisible until their flight starts (survives the
    // re-render burst that a deal/draw kicks off).
    hideQueuedCards(fan);
    dock.appendChild(fan);
  }

  renderControls(dock, state);

  wrap.appendChild(board);
  wrap.appendChild(dock);
  root.appendChild(wrap);

  // Deal/draw motion: once this render (and the burst it belongs to) settles,
  // fly any queued cards out of the stock/discard pile into the hand.
  scheduleHandPitch(root);
  prevPendingDraw = state.pendingDraw;

  renderStandingsModal(root, state);
  renderWildPickerModal(root, state);
  renderDiscardLogModal(root, state);
}
