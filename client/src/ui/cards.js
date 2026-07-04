import { cardKey } from "../state/store.js";

const RED_SUITS = new Set(["H", "D"]);

// Rendered as inline SVG rather than the Unicode suit characters (♠♥♦♣).
// Those glyphs aren't guaranteed to exist in whatever font a browser falls
// back to once "Space Grotesk" (which doesn't include them) misses - some
// fonts substitute a blank/.notdef glyph instead of triggering a visible
// fallback, so the suit silently disappeared while the rank text (plain
// Latin characters, which Space Grotesk does cover) rendered fine. SVG
// paths render identically everywhere, no font involved.
const SUIT_PATH = {
  S: "M8 1C5 4 1 7 1 10a4 4 0 0 0 6 3.46C6.7 14.5 5.8 15 4.5 15h7c-1.3 0-2.2-.5-2.5-1.54A4 4 0 0 0 15 10C15 7 11 4 8 1z",
  H: "M8 14S2 9.65 2 5.5C2 3 4 1 6.5 1 8 1 8 2.5 8 2.5S8 1 9.5 1C12 1 14 3 14 5.5 14 9.65 8 14 8 14z",
  D: "M8 1 14 8 8 15 2 8Z",
  C: "M9.6 9.4A2.5 2.5 0 1 0 8 6a2.5 2.5 0 1 0-1.6 3.4C6 11 5 12 4 12.5v.5h8v-.5c-1-.5-2-1.5-2.4-3.1z",
};

function suitIcon(suit) {
  const svgns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.classList.add("suit-icon");
  const path = document.createElementNS(svgns, "path");
  path.setAttribute("d", SUIT_PATH[suit]);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

function starIcon() {
  const svgns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.classList.add("suit-icon");
  const path = document.createElementNS(svgns, "path");
  path.setAttribute(
    "d",
    "M8 1l2.09 4.24 4.68.68-3.39 3.3.8 4.66L8 11.6l-4.18 2.28.8-4.66-3.39-3.3 4.68-.68z",
  );
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

export function cardLabel(card) {
  if (card.rank === "JOKER") return "★"; // used for aria-label / plain-text contexts only
  return `${card.rank}${card.suit ?? ""}`;
}

export function isWild(card, wildRank) {
  return card.rank === "JOKER" || card.rank === wildRank;
}

/**
 * Builds a card <button> element. Selection/click behavior is left to the
 * caller via onClick - this module only knows how to draw a card.
 */
export function renderCard(card, { selected = false, wild = false, onClick, tabIndex = 0 } = {}) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "card" + (selected ? " card--selected" : "") + (wild ? " card--wild" : "");
  if (card.rank !== "JOKER" && RED_SUITS.has(card.suit)) el.classList.add("card--red");
  el.setAttribute("aria-label", cardLabel(card));
  el.dataset.cardKey = cardKey(card);
  el.tabIndex = tabIndex;

  if (card.rank === "JOKER") {
    el.appendChild(starIcon());
  } else {
    const rankSpan = document.createElement("span");
    rankSpan.className = "card-rank";
    rankSpan.textContent = card.rank;
    el.appendChild(rankSpan);
    el.appendChild(suitIcon(card.suit));
  }

  if (onClick) el.addEventListener("click", () => onClick(card));
  return el;
}

export function renderCardFan(cards, { selectedKeys, wildRank, onClick }) {
  const wrap = document.createElement("div");
  wrap.className = "hand-fan";
  const n = cards.length;
  // A tighter fan (steep rotation, heavy overlap) looks nice with 3 cards
  // but hides the rank/suit of anything but the top card once a hand gets
  // past 5-6 - and this game deals up to 13. Keep only a light tilt for
  // style, and let CSS's small negative margin (not this rotation) do the
  // only real overlapping, so every card's corner stays readable.
  const maxAngle = n > 8 ? 4 : n > 4 ? 8 : 12;
  cards.forEach((card, i) => {
    const angle = n > 1 ? -maxAngle + ((2 * maxAngle) / (n - 1)) * i : 0;
    const el = renderCard(card, {
      selected: selectedKeys.has(cardKey(card)),
      wild: isWild(card, wildRank),
      onClick,
    });
    el.style.transform = `rotate(${angle}deg)`;
    el.style.zIndex = String(i);
    wrap.appendChild(el);
  });
  return wrap;
}
