// AUTO-GENERATED from packages/rules-engine/src/deck.ts — DO NOT EDIT.
// Edit the source there, then run: npm run rules:sync
export type Suit = "S" | "H" | "D" | "C";
export type Rank =
  "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "JOKER";

export interface Card {
  rank: Rank;
  suit: Suit | null; // null only for JOKER
  /** Distinguishes duplicate physical cards across multiple shuffled decks. */
  deckIndex: number;
  /**
   * Only meaningful for a wild card (JOKER or the hand's wild rank) that's
   * currently part of a RUN meld: which rank it's standing in for, so the
   * run can be displayed in sequence instead of with the wild sitting in
   * an arbitrary spot. Undefined everywhere else (in a hand, in the
   * discard pile, in a SET meld, or on a wild not yet placed in a run).
   */
  wildAs?: Rank;
}

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Exclude<Rank, "JOKER">[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/**
 * Two decks (108 cards, incl. 4 jokers) for every supported game. Capped at
 * 6 players: at the largest hand (deal size 13) even 6 players leaves only
 * ~29 stock cards, and 7+ would run the deck dry.
 */
export function decksForPlayerCount(playerCount: number): number {
  if (playerCount < 2 || playerCount > 6) {
    throw new Error("Pay Me supports 2-6 players");
  }
  return 2;
}

export function buildDeck(numDecks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, deckIndex: d });
      }
    }
    cards.push({ rank: "JOKER", suit: null, deckIndex: d });
    cards.push({ rank: "JOKER", suit: null, deckIndex: d });
  }
  return cards;
}

/** Deterministic-seedable Fisher-Yates shuffle so tests can assert on ordering. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function isWildCard(card: Card, wildRank: Rank): boolean {
  return card.rank === "JOKER" || card.rank === wildRank;
}

export function cardKey(card: Card): string {
  return `${card.rank}${card.suit ?? ""}#${card.deckIndex}`;
}
