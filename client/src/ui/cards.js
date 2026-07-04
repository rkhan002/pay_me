import { cardKey } from "../state/store.js";

const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS = new Set(["H", "D"]);

export function cardLabel(card) {
  if (card.rank === "JOKER") return "★"; // star stands in for the joker
  return `${card.rank}${SUIT_SYMBOL[card.suit] ?? ""}`;
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
  el.textContent = cardLabel(card);
  el.dataset.cardKey = cardKey(card);
  el.tabIndex = tabIndex;
  if (onClick) el.addEventListener("click", () => onClick(card));
  return el;
}

export function renderCardFan(cards, { selectedKeys, wildRank, onClick }) {
  const wrap = document.createElement("div");
  wrap.className = "hand-fan";
  const n = cards.length;
  cards.forEach((card, i) => {
    const angle = n > 1 ? -18 + (36 / (n - 1)) * i : 0;
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
