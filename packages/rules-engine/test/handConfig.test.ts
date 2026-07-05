import { describe, expect, it } from "vitest";
import { HAND_CONFIGS, configForHand, startingSeatIndex, TOTAL_HANDS } from "../src/handConfig";

describe("HAND_CONFIGS", () => {
  it("has exactly 11 hands", () => {
    expect(TOTAL_HANDS).toBe(11);
    expect(HAND_CONFIGS).toHaveLength(11);
  });

  it("deal size increases from 3 to 13, one card per hand", () => {
    HAND_CONFIGS.forEach((config, i) => {
      expect(config.dealSize).toBe(3 + i);
    });
  });

  it("wild rank advances 3,4,5,6,7,8,9,10,J,Q,K in order", () => {
    const expected = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    expect(HAND_CONFIGS.map((c) => c.wildRank)).toEqual(expected);
  });

  it("configForHand looks up a specific hand", () => {
    expect(configForHand(1)).toEqual({ handNumber: 1, wildRank: "3", dealSize: 3 });
    expect(configForHand(11)).toEqual({ handNumber: 11, wildRank: "K", dealSize: 13 });
  });

  it("throws for an out-of-range hand number", () => {
    expect(() => configForHand(12)).toThrow();
    expect(() => configForHand(0)).toThrow();
  });
});

describe("startingSeatIndex", () => {
  it("alternates for exactly 2 players", () => {
    const seats = HAND_CONFIGS.map((c) => startingSeatIndex(c.handNumber, 2));
    expect(seats).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it("round-robins through all seats for 3 players", () => {
    const seats = HAND_CONFIGS.map((c) => startingSeatIndex(c.handNumber, 3));
    expect(seats).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1]);
  });

  it("round-robins through all seats for 4 players", () => {
    const seats = HAND_CONFIGS.map((c) => startingSeatIndex(c.handNumber, 4));
    expect(seats).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2]);
  });

  it("never leads the same seat twice in a row for any player count from 2 to 8", () => {
    for (let playerCount = 2; playerCount <= 8; playerCount++) {
      let previous = -1;
      for (let handNumber = 1; handNumber <= TOTAL_HANDS; handNumber++) {
        const seat = startingSeatIndex(handNumber, playerCount);
        expect(seat).toBeGreaterThanOrEqual(0);
        expect(seat).toBeLessThan(playerCount);
        if (playerCount > 1) expect(seat).not.toBe(previous);
        previous = seat;
      }
    }
  });
});
