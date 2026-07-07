import { describe, expect, it } from "vitest";
import { buildDeck, decksForPlayerCount } from "../src/deck";
import { dealCards, reshuffleDiscardIntoStock } from "../src/deal";

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
