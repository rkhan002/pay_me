// The client's entire local state: a snapshot of what the server last told
// us, plus a couple of purely-visual UI selections (which cards are
// highlighted for a proposed meld). Nothing in here decides whether a move
// is legal - that's the server's job. This module just holds data and
// notifies whoever is rendering it.
const listeners = new Set();

let state = {
  screen: "lobby", // 'lobby' | 'table'
  userId: null,
  error: null,

  room: null, // { id, code, status, maxPlayers, currentHandNumber, totalHands }
  players: [], // [{ id, seatIndex, displayName, connected, userId, avatar }]
  myPlayerId: null,

  hand: null, // { id, handNumber, wildRank, dealSize, discardPile, turnPlayerId, hasDrawnThisTurn, phase, payMeCallerId, pendingFinalTurns, pendingLayoffs }
  myCards: [], // Card[]
  publicHandInfo: [], // [{ playerId, cardCount, score, hasTakenFinalTurn }]
  melds: [], // [{ id, ownerPlayerId, meldType, cards: [{rank,suit,deckIndex,position,addedByPlayerId}] }]

  selectedCardKeys: new Set(),

  // Which draw button this player last used ("stock" | "discard" | null) -
  // purely cosmetic, so the button stays visibly "selected" the same way a
  // chosen card does. Never explicitly cleared: it's only ever read behind
  // a myTurn && hasDrawnThisTurn check (see table.js), both of which go
  // false again the moment this turn ends, so a stale value here can never
  // show through on a later turn.
  drawnSource: null,

  standings: [], // [{ playerId, displayName, cumulativeScore, payMeWins }], lowest score first (ties: most Pay Me's)
  standingsHandsPlayed: 0,
  showStandings: false,

  // Set whenever the server responds to a propose-meld/layoff-card call with
  // needsWildDesignation - see network/intents.js. Null the rest of the time.
  // { kind: "meld", handId, cards, meldType, arrangements } |
  // { kind: "layoff", handId, card, meldId, candidateRanks }
  wildPicker: null,
};

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cardKey(card) {
  return `${card.rank}${card.suit ?? ""}#${card.deckIndex}`;
}

export function toggleCardSelection(card) {
  const key = cardKey(card);
  const next = new Set(state.selectedCardKeys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setState({ selectedCardKeys: next });
}

export function clearSelection() {
  setState({ selectedCardKeys: new Set() });
}
