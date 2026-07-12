// AUTO-GENERATED from packages/rules-engine/src/deal.ts — DO NOT EDIT.
// Edit the source there, then run: npm run rules:sync
import { buildDeck, decksForPlayerCount, shuffle, type Card } from "./deck.ts";

export interface DealResult {
  hands: Record<string, Card[]>;
  stock: Card[];
  discardPile: Card[];
}

/**
 * Deals `dealSize` cards to each player off the top of an already-ordered
 * `deck`, then flips the next card face-up to start the discard pile (the
 * upcard). The deck is consumed top-first and never shuffled here - the
 * caller decides how it was ordered: a fresh shuffle for the first hand of a
 * game (dealCards), or a carried-over deck for later hands (buildCarryOverDeck).
 */
export function dealFromDeck(playerIds: string[], dealSize: number, deck: Card[]): DealResult {
  const hands: Record<string, Card[]> = {};
  for (const id of playerIds) hands[id] = [];

  let cursor = 0;
  for (let round = 0; round < dealSize; round++) {
    for (const id of playerIds) {
      hands[id].push(deck[cursor]);
      cursor++;
    }
  }

  const upcard = deck[cursor];
  cursor++;

  const stock = deck.slice(cursor);
  const discardPile = [upcard];

  return { hands, stock, discardPile };
}

/**
 * First hand of a game: build a fresh multi-deck, shuffle it, and deal off
 * the top. Later hands carry the deck over instead (see buildCarryOverDeck).
 */
export function dealCards(
  playerIds: string[],
  dealSize: number,
  rng: () => number = Math.random,
): DealResult {
  const numDecks = decksForPlayerCount(playerIds.length);
  const deck = shuffle(buildDeck(numDecks), rng);
  return dealFromDeck(playerIds, dealSize, deck);
}

/**
 * Builds the deck for a carried-over hand. The cards never drawn last hand
 * (`remainingStock`) stay in their existing order on the TOP of the deck, so
 * play continues seamlessly off the same stock; everything reclaimed from the
 * finished hand (`reclaimed` = discard pile + players' leftover hand cards +
 * melded cards, with any wild-in-a-run designation already stripped back to a
 * plain card) is shuffled and placed UNDERNEATH. Dealing then proceeds from the
 * top via dealFromDeck. This one shuffle of the reclaimed remainder is the only
 * shuffle between hands - a mid-hand stock-out still reshuffles the discard
 * pile separately (see reshuffleDiscardIntoStock).
 */
export function buildCarryOverDeck(
  remainingStock: Card[],
  reclaimed: Card[],
  rng: () => number = Math.random,
): Card[] {
  return [...remainingStock, ...shuffle(reclaimed, rng)];
}

/**
 * When the stock runs out mid-hand: reshuffle the discard pile, keeping the
 * current top card (upcard) in place, into a fresh stock.
 */
export function reshuffleDiscardIntoStock(
  discardPile: Card[],
  rng: () => number = Math.random,
): { stock: Card[]; discardPile: Card[] } {
  if (discardPile.length <= 1) {
    return { stock: [], discardPile };
  }
  const [top, ...rest] = discardPile;
  return { stock: shuffle(rest, rng), discardPile: [top] };
}
