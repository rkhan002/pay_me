import {
  getState,
  setState,
  toggleCardSelection,
  clearSelection,
  cardKey,
} from "../state/store.js";
import { renderCard, renderCardFan } from "./cards.js";
import {
  startHand,
  drawStock,
  drawDiscard,
  discardCard,
  proposeMeld,
  layOffCard,
  passLayoff,
} from "../network/intents.js";
import { loadRoom, loadHand } from "../network/queries.js";

function selectedCards() {
  const { myCards, selectedCardKeys } = getState();
  return myCards.filter((c) => selectedCardKeys.has(cardKey(c)));
}

function isMyTurn(state) {
  return state.hand && state.hand.turnPlayerId === state.myPlayerId;
}

// Realtime eventually tells every other player about a successful action,
// but the player who just took the action shouldn't have to wait on a
// round trip through Postgres Changes to see their own move reflected -
// and if realtime is ever slow, down, or misconfigured, an unrefreshed
// screen looks exactly like "nothing happened", which invites exactly the
// kind of repeated re-clicking that causes duplicate actions. So every
// guarded call refreshes this client's own state directly after success.
async function guard(fn, refresh) {
  try {
    await fn();
    if (refresh) await refresh();
  } catch (e) {
    setState({ error: e.message });
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
  for (const meld of state.melds) {
    const meldEl = document.createElement("div");
    meldEl.className = "meld";
    meldEl.dataset.meldId = meld.id;
    for (const card of meld.cards) {
      meldEl.appendChild(
        renderCard(card, { wild: card.rank === "JOKER" || card.rank === state.hand?.wildRank }),
      );
    }
    meldEl.addEventListener("click", () => {
      const [card] = selectedCards();
      if (!card) {
        setState({
          error: "Select one card from your hand first, then click a meld to lay it off.",
        });
        return;
      }
      guard(
        () => layOffCard(state.hand.id, card, meld.id),
        () => loadHand(state.hand.id),
      ).then(clearSelection);
    });
    section.appendChild(meldEl);
  }
  root.appendChild(section);
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

  const drawStockBtn = document.createElement("button");
  drawStockBtn.className = "btn";
  drawStockBtn.textContent = "Draw from stock";
  drawStockBtn.disabled = !myTurn || state.hand.hasDrawnThisTurn || inLayoff;
  drawStockBtn.addEventListener("click", () =>
    guard(
      () => drawStock(state.hand.id),
      () => loadHand(state.hand.id),
    ),
  );
  bar.appendChild(drawStockBtn);

  const drawDiscardBtn = document.createElement("button");
  drawDiscardBtn.className = "btn";
  drawDiscardBtn.textContent = "Draw from discard";
  drawDiscardBtn.disabled = !myTurn || state.hand.hasDrawnThisTurn || inLayoff;
  drawDiscardBtn.addEventListener("click", () =>
    guard(
      () => drawDiscard(state.hand.id),
      () => loadHand(state.hand.id),
    ),
  );
  bar.appendChild(drawDiscardBtn);

  const setBtn = document.createElement("button");
  setBtn.className = "btn";
  setBtn.textContent = "Meld as set";
  setBtn.disabled = !myTurn || !state.hand.hasDrawnThisTurn || selectedCards().length < 3;
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
  runBtn.disabled = !myTurn || !state.hand.hasDrawnThisTurn || selectedCards().length < 3;
  runBtn.addEventListener("click", () =>
    guard(
      () => proposeMeld(state.hand.id, selectedCards(), "RUN"),
      () => loadHand(state.hand.id),
    ).then(clearSelection),
  );
  bar.appendChild(runBtn);

  const discardBtn = document.createElement("button");
  discardBtn.className = "btn btn--primary";
  discardBtn.textContent = "Discard selected";
  discardBtn.disabled = !myTurn || !state.hand.hasDrawnThisTurn || selectedCards().length !== 1;
  discardBtn.addEventListener("click", () =>
    guard(
      () => discardCard(state.hand.id, selectedCards()[0]),
      () => loadHand(state.hand.id),
    ).then(clearSelection),
  );
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
    <div class="room-code">Room ${state.room?.code ?? ""}</div>
    <div class="hand-info">${
      state.hand
        ? `Hand ${state.hand.handNumber}/11 &middot; wild: ${state.hand.wildRank}`
        : "Waiting to deal"
    }</div>
  `;
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

    const fan = renderCardFan(state.myCards, {
      selectedKeys: state.selectedCardKeys,
      wildRank: state.hand?.wildRank,
      onClick: (card) => toggleCardSelection(card),
    });
    wrap.appendChild(fan);
  }

  root.appendChild(wrap);
}
