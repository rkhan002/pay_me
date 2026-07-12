import { cardKey } from "../state/store.js";

// Each suit gets its own color (see the matching rules in style.css) rather
// than the old red/black-only split, so all four are distinguishable at a
// glance instead of hearts and diamonds (or spades and clubs) looking
// identical.
const SUIT_CLASS = {
  H: "card--suit-h",
  D: "card--suit-d",
  C: "card--suit-c",
  S: "card--suit-s",
};

// Rendered as inline SVG rather than the Unicode suit characters (♠♥♦♣).
// Those glyphs aren't guaranteed to exist in whatever font a browser falls
// back to once "Space Grotesk" (which doesn't include them) misses - some
// fonts substitute a blank/.notdef glyph instead of triggering a visible
// fallback, so the suit silently disappeared while the rank text (plain
// Latin characters, which Space Grotesk does cover) rendered fine. SVG
// paths render identically everywhere, no font involved.
//
// Paths are jean_victor_balin's classic public-domain suit shapes
// (openclipart.org, card_pique/card_coeur/card_carreau/card_trefle,
// CC0/public domain) on their native 40x40 viewBox - fuller, more
// traditional silhouettes than the earlier placeholder glyphs. Their
// original flat red (#d40000) fill is dropped in favor of
// fill="currentColor" so each suit still picks up its own color (see
// SUIT_CLASS/style.css - a distinct neon per suit, lime when wild) via
// CSS, same as before.
//
// The diamond is a straight-edged rhombus (four flat sides, four sharp
// points) rather than the openclipart original, which turned out to have
// gently curved/concave sides - fine in isolation, but next to the crisp
// points of the other three suits it read as soft and rounded instead of
// a sharp card-suit diamond.
const SUIT_PATH = {
  S: "m9.9958 40c7.2112-1.603 7.9872-5.826 8.5312-13.594-1.253 2.075-3.531 3.607-7.25 3.594-6.1124-0.021-10.207-3.576-8.75-11.25 1.4688-7.737 12.469-10.737 17.469-18.75 5 8.0128 16 11.013 17.469 18.75 1.456 7.674-2.469 11.228-8.75 11.25-3.719 0.013-5.997-1.519-7.25-3.594 0.544 7.768 1.319 11.991 8.531 13.594h-20z",
  H: "m20 10c0.97-5 2.911-10 9.702-10 6.792 0 12.128 5 9.703 15-2.426 10-13.584 15-19.405 25-5.821-10-16.979-15-19.405-25-2.4254-10 2.9109-15 9.703-15 6.791 0 8.732 5 9.702 10z",
  D: "M20 2L37 20L20 38L3 20Z",
  C: "m20 0c-4.731 0-8.571 4.032-8.571 9 0.041 3.126 1.654 5.768 3.333 8.281-1.871-1.416-3.951-2.272-6.1906-2.281-4.7314 0-8.5714 4.032-8.5714 9s3.84 9 8.5714 9c3.8326-0.064 6.8986-2.746 9.9106-5-0.539 6.733-1.635 10.514-8.006 12h19.048c-6.371-1.486-7.467-5.267-8.006-12 2.977 2.552 6.1 4.717 9.911 5 4.731 0 8.571-4.032 8.571-9s-3.84-9-8.571-9c-2.297 0-4.281 1.057-6.191 2.281 1.9-2.487 3.151-5.17 3.333-8.281 0-4.968-3.84-9-8.571-9z",
};

// The straight-edged rhombus above already fills most of its 40x40 box
// at a size that matches the other suits' visual weight, so it no longer
// needs the corrective up-scale the old, smaller curved shape did.
const SUIT_SCALE = {};

export function suitIcon(suit) {
  const svgns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.classList.add("suit-icon");
  const path = document.createElementNS(svgns, "path");
  path.setAttribute("d", SUIT_PATH[suit]);
  path.setAttribute("fill", "currentColor");
  const scale = SUIT_SCALE[suit];
  if (scale) path.setAttribute("transform", `translate(20 20) scale(${scale}) translate(-20 -20)`);
  svg.appendChild(path);
  return svg;
}

function starIcon() {
  const svgns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  // Noticeably larger than the 12px suit icons (and given its own class,
  // not just "suit-icon") so a wild card reads as a wild card at a glance
  // instead of looking like a fourth, oddly-shaped suit.
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.classList.add("suit-icon", "wild-star-icon");
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
  if (card.rank !== "JOKER") el.classList.add(SUIT_CLASS[card.suit]);
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

  if (!selected) return el;

  // Wrap only when selected, so the corner badge has a positioning
  // anchor without changing every card's DOM shape - the ring itself
  // (see .card--selected in style.css) needs no wrapper, only the
  // badge does. .card-wrap is a plain inline-flex span, so it doesn't
  // disturb the flex layouts (.hand-fan, .meld, .discard-pile) that
  // render cards directly today.
  const wrap = document.createElement("span");
  wrap.className = "card-wrap";
  wrap.appendChild(el);

  const badge = document.createElement("span");
  badge.className = "card-selected-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.innerHTML =
    '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M13 4L6 11L3 8" stroke="#0b0e1a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  wrap.appendChild(badge);
  return wrap;
}

export function renderCardFan(cards, { selectedKeys, wildRank, onClick }) {
  const wrap = document.createElement("div");
  wrap.className = "hand-fan";
  // Straight row, evenly spaced by the flex layout + each card's CSS
  // margin - no per-card rotation. The earlier fan-style tilt read as
  // "uneven" rather than card-game-stylish once hands got past a few
  // cards, and it added nothing readability-wise now that CSS's gap (not
  // overlap) is what keeps every card's corner visible anyway.
  cards.forEach((card, i) => {
    const el = renderCard(card, {
      selected: selectedKeys.has(cardKey(card)),
      wild: isWild(card, wildRank),
      onClick,
    });
    el.style.zIndex = String(i);
    wrap.appendChild(el);
  });
  return wrap;
}

/**
 * A face-down card - the game's "Pay Me" house back, used for the stock
 * deck, opponents' concealed hands, and any other hidden card. Pass
 * `interactive: true` to get a real <button> (e.g. the top of the stock
 * pile, which draws a card); otherwise it's a non-interactive, aria-hidden
 * <div> for a purely decorative back. `onClick` here takes no card argument,
 * unlike renderCard's - a face-down card has no identity to hand back.
 */
export function renderCardBack({
  interactive = false,
  disabled = false,
  onClick,
  small = false,
  className = "",
  ariaLabel = "Face-down card",
} = {}) {
  const el = document.createElement(interactive ? "button" : "div");
  el.className =
    "card card-back" + (small ? " card-back--sm" : "") + (className ? " " + className : "");
  if (interactive) {
    el.type = "button";
    el.disabled = disabled;
    el.setAttribute("aria-label", ariaLabel);
    if (onClick) el.addEventListener("click", onClick);
  } else {
    el.setAttribute("aria-hidden", "true");
  }

  const logo = document.createElement("div");
  logo.className = "card-back-logo";
  const l1 = document.createElement("span");
  l1.className = "cb-l1";
  l1.textContent = "PAY";
  const l2 = document.createElement("span");
  l2.className = "cb-l2";
  l2.textContent = "ME";
  logo.appendChild(l1);
  logo.appendChild(l2);
  el.appendChild(logo);
  return el;
}
