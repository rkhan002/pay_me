import { createRoom, joinRoom } from "../network/intents.js";
import { setState } from "../state/store.js";
import { loadRoom } from "../network/queries.js";
import { subscribeToRoom } from "../network/realtime.js";

async function enterRoom(roomId, playerId) {
  setState({ screen: "table", myPlayerId: playerId, error: null });
  await loadRoom(roomId);
  subscribeToRoom(roomId);
}

export function renderLobby(root) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "lobby";

  const logo = document.createElement("div");
  logo.className = "logo";
  logo.innerHTML = `<h1>PAY ME</h1><div class="suits">♠ ♥ ♦ ♣</div>`;
  wrap.appendChild(logo);

  const card = document.createElement("div");
  card.className = "lobby-card";

  const nameField = document.createElement("div");
  nameField.className = "field";
  nameField.innerHTML = `<label for="displayName">Your name</label>`;
  const nameInput = document.createElement("input");
  nameInput.id = "displayName";
  nameInput.placeholder = "e.g. Rahim";
  nameInput.maxLength = 24;
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  const joinField = document.createElement("div");
  joinField.className = "field";
  joinField.innerHTML = `<label for="roomCode">Room code</label>`;
  const codeInput = document.createElement("input");
  codeInput.id = "roomCode";
  codeInput.placeholder = "ROOM CODE";
  codeInput.maxLength = 6;
  codeInput.style.textTransform = "uppercase";
  codeInput.style.letterSpacing = "0.2em";
  joinField.appendChild(codeInput);
  card.appendChild(joinField);

  const joinBtn = document.createElement("button");
  joinBtn.className = "btn btn--primary";
  joinBtn.textContent = "Join table";
  joinBtn.addEventListener("click", async () => {
    try {
      const { roomId, playerId } = await joinRoom(codeInput.value.trim(), nameInput.value.trim());
      await enterRoom(roomId, playerId);
    } catch (e) {
      setState({ error: e.message });
    }
  });
  card.appendChild(joinBtn);

  const divider = document.createElement("div");
  divider.className = "lobby-divider";
  divider.textContent = "or";
  card.appendChild(divider);

  const createBtn = document.createElement("button");
  createBtn.className = "btn btn--secondary";
  createBtn.textContent = "Start a new table";
  createBtn.addEventListener("click", async () => {
    try {
      const { roomId, playerId } = await createRoom(nameInput.value.trim() || "Host");
      await enterRoom(roomId, playerId);
    } catch (e) {
      setState({ error: e.message });
    }
  });
  card.appendChild(createBtn);

  wrap.appendChild(card);
  root.appendChild(wrap);
}
