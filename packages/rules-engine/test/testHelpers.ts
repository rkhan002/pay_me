import type { Card, Rank, Suit } from "../src/deck";

export function card(rank: Rank, suit: Suit | null = null, deckIndex = 0): Card {
  return { rank, suit, deckIndex };
}

export function joker(deckIndex = 0): Card {
  return { rank: "JOKER", suit: null, deckIndex };
}
