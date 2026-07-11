import {
  getState,
  setState,
  toggleCardSelection,
  clearSelection,
  cardKey,
} from "../state/store.js";
import { renderCard, renderCardFan } from "./cards.js";
import { commitOrder, sortByRank, sortBySuit, makeHandFanDraggable } from "./handOrder.js";
import {
  startHand,
  drawStock,
  drawDiscard,
  discardCard,
  proposeMeld,
  layOffCard,
  passLayoff,
  skipStalePlayer,
  unmeld,
} from "../network/intents.js";
import { loadRoom, loadHand, loadStandings } from "../network/queries.js";
import { isMusicEnabled, isSfxEnabled, toggleMusic, toggleSfx } from "../audio/audioManager.js";

function selectedCards() {
  const { myCards, selectedCardKeys } = getState();
  return myCards.filter((c) => selectedCardKeys.has(cardKey(c)));
}

function isMyTurn(state) {
  return state.hand && state.hand.turnPlayerId === state.myPlayerId;
}

function isWildCard(card, wildRank) {
  return card.rank === "JOKER" || card.rank === wildRank;
}

// A RUN meld/lay-off involving a wild card comes back from the server as
// { ok: false, needsWildDesignation: true, ... } instead of erroring or
// guessing - see propose-meld/layoff-card's edge functions. This opens the
// picker modal (see renderWildPickerModal) instead of treating it as either
// a success or a rejected move.
async function proposeRun(state) {
  const cards = selectedCards();
  setState({ error: null });
  try {
    const result = await proposeMeld(state.hand.id, cards, "RUN");
    if (result.needsWildDesignation) {
      setState({
        wildPicker: {
          kind: "meld",
          handId: state.hand.id,
          cards,
          arrangements: result.arrangements,
        },
      });
      return;
    }
    await loadHand(state.hand.id);
    clearSelection();
  } catch (e) {
    setState({ error: e.message });
  }
}

async function unmeldMeld(state, meldId) {
  setState({ error: null });
  try {
    await unmeld(state.hand.id, meldId);
    await loadHand(state.hand.id);
  } catch (e) {
    setState({ error: e.message });
  }
}

async function layOffOntoMeld(state, meldId) {
  const [card] = selectedCards();
  if (!card) {
    setState({
      error: "Select one card from your hand first, then click a meld to lay it off.",
    });
    return;
  }
  setState({ error: null });
  try {
    const result = await layOffCard(state.hand.id, card, meldId);
    if (result.needsWildDesignation) {
      setState({
        wildPicker: {
          kind: "layoff",
          handId: state.hand.id,
          card,
          meldId,
          candidateRanks: result.candidateRanks,
        },
      });
      return;
    }
    await loadHand(state.hand.id);
    clearSelection();
  } catch (e) {
    setState({ error: e.message });
  }
}

/**
 * Submits the player's choice from the wild-designation picker: for a meld,
 * pairs each wild card (in hand-selection order) with the chosen
 * arrangement's wild ranks (ascending) - which physical wild gets which
 * rank doesn't matter to the server, only that the multiset matches (see
 * validateWildAssignments), and sortRunCards places each card correctly by
 * its own assigned rank regardless of that pairing.
 */
async function submitWildPicker(picker, choice) {
  setState({ error: null });
  try {
    if (picker.kind === "meld") {
      const wilds = picker.cards.filter((c) => isWildCard(c, getState().hand.wildRank));
      const wildAssignments = {};
      wilds.forEach((w, i) => {
        wildAssignments[cardKey(w)] = choice.wildRanks[i];
      });
      await proposeMeld(picker.handId, picker.cards, "RUN", wildAssignments);
    } else {
      await layOffCard(picker.handId, picker.card, picker.meldId, choice);
    }
    setState({ wildPicker: null });
    await loadHand(picker.handId);
    clearSelection();
  } catch (e) {
    setState({ error: e.message, wildPicker: null });
  }
}

// Realtime eventually tells every other player about a successful action,
// but the player who just took the action shouldn't have to wait on a
// round trip through Postgres Changes to see their own move reflected -
// and if realtime is ever slow, down, or misconfigured, an unrefreshed
// screen looks exactly like "nothing happened", which invites exactly the
// kind of repeated re-clicking that causes duplicate actions. So every
// guarded call refreshes this client's own state directly after success.
//
// Clearing the error up front (rather than only on success) means a stale
// message from a previous failed attempt disappears the moment the player
// tries anything else, instead of sitting on screen indefinitely - it
// used to only clear if the player clicked the banner itself, so it could
// linger through several successful actions afterward.
// A single action is allowed in flight at a time, so a laggy round trip can't
// be fired twice by an impatient re-click.
let actionInFlight = false;
async function guard(fn, refresh, optimistic) {
  if (actionInFlight) return;
  actionInFlight = true;
  setState({ error: null });
  // Show the move immediately (optimistic), before the server round trip, so
  // the click never *looks* like nothing happened. `refresh` then reconciles
  // with the authoritative server state - and if the move is rejected, that
  // same refresh restores the truth, undoing the optimistic change.
  if (optimistic) setState(optimistic);
  try {
    await fn();
    if (refresh) await refresh();
  } catch (e) {
    setState({ error: e.message });
    if (refresh) await refresh().catch(() => {});
  } finally {
    actionInFlight = false;
  }
}

function renderOpponents(root, state) {
  const row = document.createElement("div");
  row.className = "opponents-row";
  for (const player of state.players) {
    const info = state.publicHandInfo.find((p) => p.playerId === player.id);
    const seat = document.createElement("div");
    seat.className = "seat";
    if (state.hand?.turnPlayerId === player.id) seat.classList.add("seat--active");
    if (player.id === state.hand?.payMeCallerId) seat.classList.add("seat--pay-me");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = player.displayName.slice(0, 2).toUpperCase();
    if (!player.connected) avatar.classList.add("avatar--disconnected");
    seat.appendChild(avatar);

    const name = document.createElement("div");
    name.className = "seat-name";
    name.textContent = player.displayName;
    seat.appendChild(name);

    if (info) {
      const count = document.createElement("div");
      count.className = "seat-count";
      count.textContent = `${info.cardCount} card${info.cardCount === 1 ? "" : "s"}`;
      seat.appendChild(count);
    }

    row.appendChild(seat);
  }
  root.appendChild(row);
}

function renderMelds(root, state) {
  const section = document.createElement("div");
  section.className = "melds";
  // Pay Me hasn't been declared yet - melds are still private (each
  // player's own melds only, per RLS - see supabase/migrations), and the
  // owner can still change their mind and take one back.
  const canUnmeld = !state.hand?.payMeCallerId;
  for (const meld of state.melds) {
    const meldEl = document.createElement("div");
    meldEl.className = "meld";
    meldEl.dataset.meldId = meld.id;
    for (const card of meld.cards) {
      meldEl.appendChild(
        renderCard(card, { wild: card.rank === "JOKER" || card.rank === state.hand?.wildRank }),
      );
    }
    if (canUnmeld && meld.ownerPlayerId === state.myPlayerId) {
      const unmeldBtn = document.createElement("button");
      unmeldBtn.type = "button";
      unmeldBtn.className = "btn btn--secondary unmeld-btn";
      unmeldBtn.textContent = "Unmeld";
      unmeldBtn.addEventListener("click", (e) => {
        // Otherwise this bubbles up to meldEl's own click listener below,
        // which would try to lay a selected card off onto this meld instead.
        e.stopPropagation();
        unmeldMeld(state, meld.id);
      });
      meldEl.appendChild(unmeldBtn);
    }
    meldEl.addEventListener("click", () => layOffOntoMeld(state, meld.id));
    section.appendChild(meldEl);
  }
  root.appendChild(section);
}

function renderStandingsModal(root, state) {
  if (!state.showStandings) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  // Clicking the dimmed backdrop (not the card itself) closes it, same as
  // any standard modal - clicking inside the card must not bubble here.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) setState({ showStandings: false });
  });

  const card = document.createElement("div");
  card.className = "modal-card";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "Scores";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "modal-subtitle";
  subtitle.textContent =
    state.standingsHandsPlayed === 0
      ? "No hands completed yet"
      : `Lower score is better · ${state.standingsHandsPlayed} hand${
          state.standingsHandsPlayed === 1 ? "" : "s"
        } played`;
  card.appendChild(subtitle);

  const table = document.createElement("div");
  table.className = "standings-table";
  for (const entry of state.standings) {
    const row = document.createElement("div");
    row.className = "standings-row";

    const name = document.createElement("span");
    name.className = "standings-name";
    name.textContent = entry.displayName;
    row.appendChild(name);

    // Always render this slot, even empty - it's a fixed-width grid column
    // (see CSS) so every row's badge and score line up in neat columns
    // instead of the score shifting left/right depending on whether that
    // particular row happens to have a badge.
    const badgeSlot = document.createElement("span");
    badgeSlot.className = "standings-badge-slot";
    if (entry.payMeWins > 0) {
      const badge = document.createElement("span");
      badge.className = "badge-payme";
      badge.textContent = `★ ${entry.payMeWins}`;
      badge.title = `${entry.payMeWins} Pay Me call${entry.payMeWins === 1 ? "" : "s"}`;
      badgeSlot.appendChild(badge);
    }
    row.appendChild(badgeSlot);

    const score = document.createElement("span");
    score.className = "standings-score";
    score.textContent = String(entry.cumulativeScore);
    row.appendChild(score);

    table.appendChild(row);
  }
  card.appendChild(table);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn--primary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => setState({ showStandings: false }));
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  root.appendChild(overlay);
}

function renderWildPickerModal(root, state) {
  const picker = state.wildPicker;
  if (!picker) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "What's the wild card?";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "modal-subtitle";
  subtitle.textContent =
    picker.kind === "meld"
      ? "This run has more than one way to complete it - pick which one."
      : "Which end of the run is this card extending?";
  card.appendChild(subtitle);

  const options = document.createElement("div");
  options.className = "wild-picker-options";

  if (picker.kind === "meld") {
    for (const arrangement of picker.arrangements) {
      const btn = document.createElement("button");
      btn.className = "btn btn--primary";
      btn.textContent = arrangement.orderedRanks.join(", ");
      btn.addEventListener("click", () => submitWildPicker(picker, arrangement));
      options.appendChild(btn);
    }
  } else {
    for (const rank of picker.candidateRanks) {
      const btn = document.createElement("button");
      btn.className = "btn btn--primary";
      btn.textContent = rank;
      btn.addEventListener("click", () => submitWildPicker(picker, rank));
      options.appendChild(btn);
    }
  }
  card.appendChild(options);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => setState({ wildPicker: null }));
  card.appendChild(cancelBtn);

  overlay.appendChild(card);
  root.appendChild(overlay);
}

function renderPayMeBanner(root, state) {
  if (!state.hand?.payMeCallerId) return;
  const caller = state.players.find((p) => p.id === state.hand.payMeCallerId);
  const banner = document.createElement("div");
  banner.className = "pay-me-banner";
  banner.textContent = `${caller ? caller.displayName : "A player"} called Pay Me!`;
  root.appendChild(banner);
}

function renderControls(root, state) {
  const bar = document.createElement("div");
  bar.className = "controls";

  const noActiveHand = !state.hand || state.hand.phase === "complete";
  if (noActiveHand && state.room) {
    // The hand that just finished still has its (already-loaded)
    // publicHandInfo scores sitting in state - show them here instead of
    // silently jumping straight to "deal the next one" with no recap.
    if (state.hand?.phase === "complete" && state.publicHandInfo.length) {
      const summary = document.createElement("div");
      summary.className = "hand-score-summary";

      const title = document.createElement("div");
      title.className = "hand-score-summary-title";
      title.textContent = `Hand ${state.hand.handNumber} scores`;
      summary.appendChild(title);

      for (const info of state.publicHandInfo) {
        const player = state.players.find((p) => p.id === info.playerId);
        const isCaller = info.playerId === state.hand.payMeCallerId;
        const row = document.createElement("div");
        row.className = "hand-score-row" + (isCaller ? " hand-score-row--caller" : "");

        const name = document.createElement("span");
        name.className = "hand-score-row-name";
        name.textContent = player?.displayName ?? "?";
        row.appendChild(name);

        // Fixed-width slot (see CSS) so the score column lines up whether
        // or not this row has a badge, same as the standings modal.
        const badgeSlot = document.createElement("span");
        badgeSlot.className = "standings-badge-slot";
        if (isCaller) {
          const badge = document.createElement("span");
          badge.className = "badge-payme";
          badge.textContent = "Pay Me";
          badgeSlot.appendChild(badge);
        }
        row.appendChild(badgeSlot);

        const score = document.createElement("span");
        score.className = "hand-score-row-score";
        score.textContent = String(info.score ?? 0);
        row.appendChild(score);

        summary.appendChild(row);
      }
      bar.appendChild(summary);
    }

    const label = state.room.currentHandNumber === 0 ? "Deal hand 1" : "Deal next hand";
    const btn = document.createElement("button");
    btn.className = "btn btn--primary";
    btn.textContent = state.room.currentHandNumber >= 11 ? "Game complete" : label;
    btn.disabled = state.room.currentHandNumber >= 11 || state.players.length < 2;
    btn.addEventListener("click", () => {
      // Belt-and-suspenders against double-fires: disable immediately so a
      // second click (or a slow network making the first click look like
      // it did nothing) can't send a second start-hand before this one's
      // refresh lands and re-renders the button away.
      btn.disabled = true;
      guard(
        () => startHand(state.room.id),
        () => loadRoom(state.room.id),
      );
    });
    bar.appendChild(btn);
    root.appendChild(bar);
    return;
  }

  if (!state.hand) {
    root.appendChild(bar);
    return;
  }

  const myTurn = isMyTurn(state);
  const inLayoff = state.hand.phase === "layoff";
  const myLayoffTurn = inLayoff && state.hand.pendingLayoffs[0] === state.myPlayerId;

  // turnPlayerId tracks whoever's action is currently expected in all three
  // active phases (playing/final_turns/layoff), not just normal turns - see
  // handRepo.ts's saveHandState. If that player has gone stale, nothing else
  // in the UI can ever move the game past them (they're not going to click
  // anything), so surface an explicit way for someone else to do it.
  const waitingOnPlayerId = state.hand.turnPlayerId;
  const waitingOnPlayer = state.players.find((p) => p.id === waitingOnPlayerId);
  const canSkipStale =
    ["playing", "final_turns", "layoff"].includes(state.hand.phase) &&
    waitingOnPlayer &&
    waitingOnPlayer.id !== state.myPlayerId &&
    !waitingOnPlayer.connected;

  if (canSkipStale) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn btn--secondary";
    skipBtn.textContent = `Skip ${waitingOnPlayer.displayName} (disconnected)`;
    skipBtn.addEventListener("click", () =>
      guard(
        () => skipStalePlayer(state.hand.id, waitingOnPlayerId),
        () => loadHand(state.hand.id),
      ),
    );
    bar.appendChild(skipBtn);
  }

  // Which draw source is "active" this turn - only meaningful once this
  // player has actually drawn, so a leftover drawnSource from a previous
  // turn never lights up the wrong button.
  const drawnStock = myTurn && state.hand.hasDrawnThisTurn && state.drawnSource === "stock";
  const drawnDiscard = myTurn && state.hand.hasDrawnThisTurn && state.drawnSource === "discard";

  const drawStockBtn = document.createElement("button");
  drawStockBtn.className = "btn" + (drawnStock ? " btn--selected" : "");
  drawStockBtn.textContent = "Draw from stock";
  drawStockBtn.disabled = !myTurn || state.hand.hasDrawnThisTurn || inLayoff;
  drawStockBtn.addEventListener("click", () =>
    guard(
      () => drawStock(state.hand.id),
      () => loadHand(state.hand.id),
      // The drawn card comes from the face-down stock, so we can't know it
      // yet - but flipping hasDrawn instantly disables the draw buttons and
      // lights up meld/discard, and the card itself pops in on refresh.
      (st) => ({ hand: { ...st.hand, hasDrawnThisTurn: true }, drawnSource: "stock" }),
    ),
  );
  bar.appendChild(drawStockBtn);

  const drawDiscardBtn = document.createElement("button");
  drawDiscardBtn.className = "btn" + (drawnDiscard ? " btn--selected" : "");
  drawDiscardBtn.textContent = "Draw from discard";
  drawDiscardBtn.disabled = !myTurn || state.hand.hasDrawnThisTurn || inLayoff;
  drawDiscardBtn.addEventListener("click", () =>
    guard(
      () => drawDiscard(state.hand.id),
      () => loadHand(state.hand.id),
      (st) => {
        const [top, ...rest] = st.hand.discardPile;
        return {
          hand: { ...st.hand, hasDrawnThisTurn: true, discardPile: rest },
          myCards: top ? [...st.myCards, top] : st.myCards,
          drawnSource: "discard",
        };
      },
    ),
  );
  bar.appendChild(drawDiscardBtn);

  // The layoff phase never involves drawing (it's a card-dump round after
  // everyone's had their real final turn), so hasDrawnThisTurn never becomes
  // true there - gating melding on it would leave these buttons permanently
  // disabled for the rest of the hand. myLayoffTurn stands in for "allowed
  // to act right now" in that phase instead.
  const canMeld = myTurn && (state.hand.hasDrawnThisTurn || myLayoffTurn);

  const setBtn = document.createElement("button");
  setBtn.className = "btn";
  setBtn.textContent = "Meld as set";
  setBtn.disabled = !canMeld || selectedCards().length < 3;
  setBtn.addEventListener("click", () =>
    guard(
      () => proposeMeld(state.hand.id, selectedCards(), "SET"),
      () => loadHand(state.hand.id),
    ).then(clearSelection),
  );
  bar.appendChild(setBtn);

  const runBtn = document.createElement("button");
  runBtn.className = "btn";
  runBtn.textContent = "Meld as run";
  runBtn.disabled = !canMeld || selectedCards().length < 3;
  runBtn.addEventListener("click", () => proposeRun(state));
  bar.appendChild(runBtn);

  const discardBtn = document.createElement("button");
  discardBtn.className = "btn btn--primary";
  discardBtn.textContent = "Discard selected";
  discardBtn.disabled = !myTurn || !state.hand.hasDrawnThisTurn || selectedCards().length !== 1;
  discardBtn.addEventListener("click", () => {
    const card = selectedCards()[0];
    guard(
      () => discardCard(state.hand.id, card),
      () => loadHand(state.hand.id),
      (st) => ({
        hand: { ...st.hand, discardPile: [card, ...st.hand.discardPile] },
        myCards: st.myCards.filter((c) => cardKey(c) !== cardKey(card)),
      }),
    ).then(clearSelection);
  });
  bar.appendChild(discardBtn);

  if (myLayoffTurn) {
    const passBtn = document.createElement("button");
    passBtn.className = "btn btn--primary";
    passBtn.textContent = "Pass (done laying off)";
    passBtn.addEventListener("click", () =>
      guard(
        () => passLayoff(state.hand.id),
        () => loadHand(state.hand.id),
      ),
    );
    bar.appendChild(passBtn);
  }

  root.appendChild(bar);
}

export function renderTable(root) {
  const state = getState();
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "table-screen";

  const header = document.createElement("div");
  header.className = "table-header";
  header.innerHTML = `
    <div class="room-code">Room: <span class="room-code-value">${state.room?.code ?? ""}</span></div>
    <div class="hand-info">${
      state.hand
        ? `Hand ${state.hand.handNumber}/11 &middot; wild: ${state.hand.wildRank}`
        : "Waiting to deal"
    }</div>
  `;
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";

  const scoresBtn = document.createElement("button");
  scoresBtn.className = "btn scores-btn";
  scoresBtn.textContent = "Scores";
  // Always available, in every phase - not gated on a hand being in
  // progress - so it works as a standings reference at any point, not
  // just once a game has started.
  scoresBtn.addEventListener("click", async () => {
    if (state.room) await loadStandings(state.room.id);
    setState({ showStandings: true });
  });
  headerActions.appendChild(scoresBtn);

  // Audio prefs aren't part of the shared game state (they're a purely
  // local, per-browser preference - see audioManager.js), so toggling
  // them updates these two buttons directly instead of going through
  // setState/a full re-render.
  const musicBtn = document.createElement("button");
  musicBtn.type = "button";
  musicBtn.className = "btn audio-toggle-btn";
  const syncMusicBtn = () => {
    const on = isMusicEnabled();
    musicBtn.textContent = on ? "Music: On" : "Music: Off";
    musicBtn.classList.toggle("audio-toggle-btn--off", !on);
  };
  syncMusicBtn();
  musicBtn.addEventListener("click", () => {
    toggleMusic();
    syncMusicBtn();
  });
  headerActions.appendChild(musicBtn);

  const sfxBtn = document.createElement("button");
  sfxBtn.type = "button";
  sfxBtn.className = "btn audio-toggle-btn";
  const syncSfxBtn = () => {
    const on = isSfxEnabled();
    sfxBtn.textContent = on ? "SFX: On" : "SFX: Off";
    sfxBtn.classList.toggle("audio-toggle-btn--off", !on);
  };
  syncSfxBtn();
  sfxBtn.addEventListener("click", () => {
    toggleSfx();
    syncSfxBtn();
  });
  headerActions.appendChild(sfxBtn);

  header.appendChild(headerActions);
  wrap.appendChild(header);

  renderOpponents(wrap, state);
  renderPayMeBanner(wrap, state);

  if (state.hand) {
    const centerRow = document.createElement("div");
    centerRow.className = "center-row";

    const discardPileEl = document.createElement("div");
    discardPileEl.className = "discard-pile";
    const topTwo = state.hand.discardPile.slice(0, 2).reverse();
    for (const card of topTwo) discardPileEl.appendChild(renderCard(card, { tabIndex: -1 }));
    centerRow.appendChild(discardPileEl);

    wrap.appendChild(centerRow);
    renderMelds(wrap, state);
  }

  renderControls(wrap, state);

  if (state.myCards.length) {
    const handLabel = document.createElement("div");
    handLabel.className = "hand-label";
    handLabel.textContent = "Your hand";
    wrap.appendChild(handLabel);

    // Card order in hand is a private, local-only preference (see
    // ui/handOrder.js) - drag to rearrange, or one-tap auto-sort. None of it
    // touches game state, so it's committed straight to local state + storage.
    const setOrder = (cards) => {
      commitOrder(state.hand?.id, cards);
      setState({ myCards: cards });
    };

    if (state.myCards.length > 1) {
      const sortBar = document.createElement("div");
      sortBar.className = "hand-sort";
      const mkSort = (label, sortFn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn hand-sort-btn";
        b.textContent = label;
        b.addEventListener("click", () => setOrder(sortFn(state.myCards, state.hand?.wildRank)));
        return b;
      };
      sortBar.appendChild(mkSort("Sort by rank", sortByRank));
      sortBar.appendChild(mkSort("Sort by suit", sortBySuit));
      wrap.appendChild(sortBar);
    }

    const fan = renderCardFan(state.myCards, {
      selectedKeys: state.selectedCardKeys,
      wildRank: state.hand?.wildRank,
      onClick: (card) => toggleCardSelection(card),
    });
    makeHandFanDraggable(fan, (keys) => {
      const byKey = new Map(state.myCards.map((c) => [cardKey(c), c]));
      const reordered = keys.map((k) => byKey.get(k)).filter(Boolean);
      // Guard against a torn drag (e.g. a realtime re-render mid-drag): only
      // commit when we still have exactly the same set of cards, reordered.
      if (reordered.length === state.myCards.length) setOrder(reordered);
    });
    wrap.appendChild(fan);
  }

  root.appendChild(wrap);
  renderStandingsModal(root, state);
  renderWildPickerModal(root, state);
}
