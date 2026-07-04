import type { Rank } from "./deck.ts";

export interface HandConfig {
  handNumber: number;
  wildRank: Rank;
  dealSize: number;
}

/** Per the House Rules table: 11 hands, deal size 3->13, wild rank 3->K. */
export const HAND_CONFIGS: HandConfig[] = [
  { handNumber: 1, wildRank: "3", dealSize: 3 },
  { handNumber: 2, wildRank: "4", dealSize: 4 },
  { handNumber: 3, wildRank: "5", dealSize: 5 },
  { handNumber: 4, wildRank: "6", dealSize: 6 },
  { handNumber: 5, wildRank: "7", dealSize: 7 },
  { handNumber: 6, wildRank: "8", dealSize: 8 },
  { handNumber: 7, wildRank: "9", dealSize: 9 },
  { handNumber: 8, wildRank: "10", dealSize: 10 },
  { handNumber: 9, wildRank: "J", dealSize: 11 },
  { handNumber: 10, wildRank: "Q", dealSize: 12 },
  { handNumber: 11, wildRank: "K", dealSize: 13 },
];

export function configForHand(handNumber: number): HandConfig {
  const config = HAND_CONFIGS.find((c) => c.handNumber === handNumber);
  if (!config) {
    throw new Error(`No such hand: ${handNumber}. Pay Me runs hands 1-11.`);
  }
  return config;
}

export const TOTAL_HANDS = HAND_CONFIGS.length;
