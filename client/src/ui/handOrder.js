// Purely local, per-hand ordering of a player's OWN hand. Card order in hand
// is a private presentation preference - it never affects the rules (the
// server validates sets/runs regardless of order, and re-sorts runs itself),
// so this lives entirely in the client and is persisted to localStorage.
//
// Keyed by hand id so a reload or reconnect restores the same arrangement,
// but a brand-new hand starts from the server's deal order. Only one hand's
// order is kept at a time (the current one), so this never accumulates.
import { cardKey } from "../state/store.js";

const STORE_KEY = "payme:hand-order";

function readStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savedOrder(handId) {
  const s = readStored();
  return s && s.handId === handId && Array.isArray(s.order) ? s.order : [];
}

/** Persist `cards`' current left-to-right order as this hand's preference. */
export function commitOrder(handId, cards) {
  if (!handId) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ handId, order: cards.map(cardKey) }));
  } catch {
    // localStorage unavailable/full - the arrangement just won't persist.
  }
}

/**
 * Returns `cards` arranged by this hand's saved preference. Cards whose key
 * isn't in the saved order (e.g. a freshly drawn card) keep their incoming
 * relative order and sit after every known card. Pure - never writes.
 */
export function orderCards(handId, cards) {
  const order = savedOrder(handId);
  if (!order.length) return cards.slice();
  const pos = new Map(order.map((k, i) => [k, i]));
  return cards
    .map((c, i) => ({ c, i, p: pos.has(cardKey(c)) ? pos.get(cardKey(c)) : Infinity }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.c);
}

const RANK_VALUE = {
  A: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  JOKER: 99,
};
const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };

function isWild(card, wildRank) {
  return card.rank === "JOKER" || card.rank === wildRank;
}

// Wilds (jokers + the hand's wild rank) collect at the end of either sort, so
// a player's "power cards" are always easy to find in one spot.
export function sortByRank(cards, wildRank) {
  return cards.slice().sort((a, b) => {
    const wa = isWild(a, wildRank),
      wb = isWild(b, wildRank);
    if (wa !== wb) return wa ? 1 : -1;
    return (
      (RANK_VALUE[a.rank] ?? 0) - (RANK_VALUE[b.rank] ?? 0) ||
      (SUIT_ORDER[a.suit] ?? 9) - (SUIT_ORDER[b.suit] ?? 9)
    );
  });
}

export function sortBySuit(cards, wildRank) {
  return cards.slice().sort((a, b) => {
    const wa = isWild(a, wildRank),
      wb = isWild(b, wildRank);
    if (wa !== wb) return wa ? 1 : -1;
    return (
      (SUIT_ORDER[a.suit] ?? 9) - (SUIT_ORDER[b.suit] ?? 9) ||
      (RANK_VALUE[a.rank] ?? 0) - (RANK_VALUE[b.rank] ?? 0)
    );
  });
}

/**
 * Makes a hand-fan element drag-reorderable via pointer events (mouse, touch,
 * pen alike). A short press-and-drag past a small threshold starts a drag and
 * live-reorders the DOM as the pointer moves; on release, `onCommit` is called
 * with the new left-to-right array of cardKeys. A plain tap (no drag) is left
 * alone so it still toggles card selection. The click that a browser fires
 * after a drag is swallowed so it can't also toggle selection.
 *
 * Fan children may be a bare `.card` button or, for a selected card, a
 * `.card-wrap` span wrapping one - both are handled.
 */
export function makeHandFanDraggable(fan, onCommit) {
  let dragEl = null;
  let startX = 0;
  let startY = 0;
  let active = false;
  let justDragged = false;
  let pointerId = null;

  const directChild = (node) => {
    let el = node;
    while (el && el.parentElement !== fan) el = el.parentElement;
    return el && el.parentElement === fan ? el : null;
  };
  const keyOf = (el) => el.dataset.cardKey || el.querySelector?.(".card")?.dataset.cardKey || null;

  const onMove = (e) => {
    if (!dragEl) return;
    if (!active) {
      if (Math.abs(e.clientX - startX) < 8 && Math.abs(e.clientY - startY) < 8) return;
      active = true;
      dragEl.classList.add("card--dragging");
      try {
        dragEl.setPointerCapture(pointerId);
      } catch {
        /* not all targets support capture; drag still works via window listeners */
      }
    }
    e.preventDefault();
    const others = [...fan.children].filter((c) => c !== dragEl);
    let before = null;
    for (const sib of others) {
      const r = sib.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        before = sib;
        break;
      }
    }
    if (before) fan.insertBefore(dragEl, before);
    else fan.appendChild(dragEl);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (dragEl && active) {
      dragEl.classList.remove("card--dragging");
      justDragged = true;
      const connected = dragEl.isConnected;
      const keys = [...fan.children].map(keyOf).filter(Boolean);
      if (connected) onCommit(keys);
    }
    dragEl = null;
    active = false;
    pointerId = null;
  };

  fan.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return; // left/primary only
    const child = directChild(e.target);
    if (!child) return;
    dragEl = child;
    startX = e.clientX;
    startY = e.clientY;
    active = false;
    pointerId = e.pointerId;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  // Swallow the synthetic click that follows a real drag so it doesn't also
  // toggle the dragged card's selection.
  fan.addEventListener(
    "click",
    (e) => {
      if (justDragged) {
        e.stopPropagation();
        e.preventDefault();
        justDragged = false;
      }
    },
    true,
  );
}
