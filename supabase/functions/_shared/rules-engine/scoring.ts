// AUTO-GENERATED from packages/rules-engine/src/scoring.ts — DO NOT EDIT.
// Edit the source there, then run: npm run rules:sync
import { isWildCard, type Card, type Rank } from "./deck.ts";

/**
 * Wild card (joker or the hand's wild rank) = 0, Ace = 15, K/Q/J/10 = 10,
 * 9 through 2 = face value.
 */
export function cardValue(card: Card, wildRank: Rank): number {
  if (isWildCard(card, wildRank)) return 0;
  if (card.rank === "A") return 15;
  if (card.rank === "K" || card.rank === "Q" || card.rank === "J" || card.rank === "10") {
    return 10;
  }
  return Number(card.rank);
}

/** The player who called Pay Me scores 0 for the hand regardless of this. */
export function scoreRemainingHand(cards: Card[], wildRank: Rank): number {
  return cards.reduce((total, card) => total + cardValue(card, wildRank), 0);
}

export interface HandScoreEntry {
  playerId: string;
  score: number;
  isPayMeCaller: boolean;
}

export function scoreHandForAllPlayers(
  handsAfterLayoff: Record<string, Card[]>,
  wildRank: Rank,
  payMeCallerId: string,
): HandScoreEntry[] {
  return Object.entries(handsAfterLayoff).map(([playerId, cards]) => {
    const isPayMeCaller = playerId === payMeCallerId;
    return {
      playerId,
      score: isPayMeCaller ? 0 : scoreRemainingHand(cards, wildRank),
      isPayMeCaller,
    };
  });
}

export interface PlayerTotals {
  playerId: string;
  cumulativeScore: number;
  payMeWins: number;
}

/**
 * Rolls per-hand results across all 11 hands into standings.
 * Winner = lowest cumulative score. Pay Me wins are tracked as a separate,
 * non-tiebreaking honor per the House Rules ("recognized as a separate tally").
 */
export function computeStandings(handResults: HandScoreEntry[][]): PlayerTotals[] {
  const totals = new Map<string, PlayerTotals>();
  for (const hand of handResults) {
    for (const entry of hand) {
      const existing = totals.get(entry.playerId) ?? {
        playerId: entry.playerId,
        cumulativeScore: 0,
        payMeWins: 0,
      };
      existing.cumulativeScore += entry.score;
      if (entry.isPayMeCaller) existing.payMeWins += 1;
      totals.set(entry.playerId, existing);
    }
  }
  return [...totals.values()].sort((a, b) => a.cumulativeScore - b.cumulativeScore);
}

export function gameWinner(handResults: HandScoreEntry[][]): PlayerTotals | undefined {
  return computeStandings(handResults)[0];
}

export function mostPayMeCalls(handResults: HandScoreEntry[][]): PlayerTotals[] {
  const standings = computeStandings(handResults);
  const max = Math.max(...standings.map((s) => s.payMeWins), 0);
  return standings.filter((s) => s.payMeWins === max && max > 0);
}
