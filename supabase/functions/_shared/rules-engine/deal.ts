import { buildDeck, decksForPlayerCount, shuffle, type Card } from "./deck.ts";

export interface DealResult {
  hands: Record<string, Card[]>;
  stock: Card[];
  discardPile: Card[];
}

/**
 * Deals `dealSize` cards to each player, then flips the next stock card
 * face-up to start the discard pile (the upcard), per House Rules setup.
 */
export function dealCards(
  playerIds: string[],
  dealSize: number,
  rng: () => number = Math.random,
): DealResult {
  const numDecks = decksForPlayerCount(playerIds.length);
  const deck = shuffle(buildDeck(numDecks), rng);

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
