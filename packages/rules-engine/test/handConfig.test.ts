import { describe, expect, it } from "vitest";
import { HAND_CONFIGS, configForHand, TOTAL_HANDS } from "../src/handConfig";

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
