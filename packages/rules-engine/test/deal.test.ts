import { describe, expect, it } from "vitest";
import { buildDeck, decksForPlayerCount } from "../src/deck";
import {
  dealCards,
  dealFromDeck,
  buildCarryOverDeck,
  reshuffleDiscardIntoStock,
} from "../src/deal";

function fixedRng(seedSeq: number[]) {
  let i = 0;
  return () => seedSeq[i++ % seedSeq.length];
}

describe("decksForPlayerCount", () => {
  it("uses 2 decks for every supported player count (2-6)", () => {
    for (const n of [2, 3, 4, 5, 6]) expect(decksForPlayerCount(n)).toBe(2);
  });
  it("rejects out-of-range player counts", () => {
    expect(() => decksForPlayerCount(1)).toThrow();
    expect(() => decksForPlayerCount(7)).toThrow();
  });
});

describe("buildDeck", () => {
  it("builds 2 decks as 108 cards (104 + 4 jokers)", () => {
    expect(buildDeck(2)).toHaveLength(108);
  });
  it("builds 3 decks as 162 cards (156 + 6 jokers)", () => {
    expect(buildDeck(3)).toHaveLength(162);
  });
});

describe("dealCards", () => {
  it("deals dealSize cards to every player and flips one upcard", () => {
    const players = ["p1", "p2", "p3", "p4"];
    const { hands, stock, discardPile } = dealCards(players, 7, Math.random);
    for (const id of players) expect(hands[id]).toHaveLength(7);
    expect(discardPile).toHaveLength(1);
    expect(stock.length).toBe(108 - players.length * 7 - 1);
  });

  it("accounts for every card in the deck (hands + stock + discard)", () => {
    const players = ["p1", "p2", "p3", "p4", "p5"];
    const { hands, stock, discardPile } = dealCards(players, 5, Math.random);
    const dealt = Object.values(hands).reduce((sum, h) => sum + h.length, 0);
    expect(dealt + stock.length + discardPile.length).toBe(108);
  });
});

describe("reshuffleDiscardIntoStock", () => {
  it("keeps the current upcard in place and reshuffles the rest into stock", () => {
    const players = ["p1", "p2"];
    const { discardPile } = dealCards(players, 3, Math.random);
    const bigDiscard = [discardPile[0], ...buildDeck(1).slice(0, 10)];
    const { stock, discardPile: newDiscard } = reshuffleDiscardIntoStock(
      bigDiscard,
      fixedRng([0.1, 0.9, 0.3]),
    );
    expect(newDiscard).toEqual([bigDiscard[0]]);
    expect(stock).toHaveLength(bigDiscard.length - 1);
  });

  it("leaves an empty stock when only the upcard remains", () => {
    const { stock, discardPile } = reshuffleDiscardIntoStock([
      { rank: "A", suit: "S", deckIndex: 0 },
    ]);
    expect(stock).toHaveLength(0);
    expect(discardPile).toHaveLength(1);
  });
});

describe("dealFromDeck", () => {
  it("deals off the top of the given deck in order, without shuffling", () => {
    // deckIndex encodes each card's original position so we can assert order
    const deck = Array.from({ length: 20 }, (_, i) => ({
      rank: "5" as const,
      suit: "S" as const,
      deckIndex: i,
    }));
    const { hands, stock, discardPile } = dealFromDeck(["p1", "p2"], 3, deck);
    // round-robin off the top: p1 <- 0,2,4 ; p2 <- 1,3,5
    expect(hands["p1"].map((c) => c.deckIndex)).toEqual([0, 2, 4]);
    expect(hands["p2"].map((c) => c.deckIndex)).toEqual([1, 3, 5]);
    expect(discardPile.map((c) => c.deckIndex)).toEqual([6]); // upcard is next off the top
    expect(stock[0].deckIndex).toBe(7); // stock continues from where the deal stopped
    expect(stock).toHaveLength(20 - 6 - 1);
  });

  it("conserves every card (hands + stock + discard = deck)", () => {
    const deck = buildDeck(2);
    const { hands, stock, discardPile } = dealFromDeck(["p1", "p2", "p3"], 8, deck);
    const dealt = Object.values(hands).reduce((s, h) => s + h.length, 0);
    expect(dealt + stock.length + discardPile.length).toBe(deck.length);
  });
});

describe("buildCarryOverDeck", () => {
  const stock = [
    { rank: "A" as const, suit: "S" as const, deckIndex: 0 },
    { rank: "2" as const, suit: "S" as const, deckIndex: 0 },
    { rank: "3" as const, suit: "S" as const, deckIndex: 0 },
  ];
  const reclaimed = [
    { rank: "K" as const, suit: "H" as const, deckIndex: 1 },
    { rank: "Q" as const, suit: "H" as const, deckIndex: 1 },
    { rank: "J" as const, suit: "H" as const, deckIndex: 1 },
    { rank: "10" as const, suit: "H" as const, deckIndex: 1 },
  ];
  const key = (c: { rank: string; suit: string | null; deckIndex: number }) =>
    `${c.rank}${c.suit}${c.deckIndex}`;

  it("keeps the leftover stock in order on top", () => {
    const deck = buildCarryOverDeck(stock, reclaimed, fixedRng([0.1, 0.5, 0.9]));
    expect(deck.slice(0, stock.length)).toEqual(stock);
  });

  it("puts every reclaimed card underneath as a permutation, conserving count", () => {
    const deck = buildCarryOverDeck(stock, reclaimed, fixedRng([0.1, 0.5, 0.9]));
    const bottom = deck.slice(stock.length);
    expect(bottom).toHaveLength(reclaimed.length);
    expect(bottom.map(key).sort()).toEqual(reclaimed.map(key).sort());
    expect(deck).toHaveLength(stock.length + reclaimed.length);
  });

  it("never reorders the stock even as the reclaimed remainder is shuffled", () => {
    const a = buildCarryOverDeck(stock, reclaimed, fixedRng([0.9, 0.1, 0.5]));
    const b = buildCarryOverDeck(stock, reclaimed, fixedRng([0.1, 0.9, 0.3]));
    expect(a.slice(0, stock.length)).toEqual(stock);
    expect(b.slice(0, stock.length)).toEqual(stock);
  });
});
