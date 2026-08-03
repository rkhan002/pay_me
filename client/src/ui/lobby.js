import { createRoom, joinRoom } from "../network/intents.js";
import { getState, setState } from "../state/store.js";
import { loadRoom } from "../network/queries.js";
import { subscribeToRoom } from "../network/realtime.js";
import {
  persistRoom,
  setRoomInUrl,
  roomCodeFromUrl,
  persistDisplayName,
  readDisplayName,
} from "../network/reconnect.js";
import { suitIcon } from "./cards.js";
import { AVATARS } from "./avatars.js";

// Host's chosen game mode for the next "Start a new table". Kept module-local
// (a purely pre-game UI choice) and defaults to the full 11-hand game.
let selectedMode = "full";

// The character icon chosen for the next join/create. Random default so a
// table looks varied out of the box; the player can change it in the picker.
let selectedAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)].id;

async function enterRoom(roomId, playerId) {
  // Load the room's actual state BEFORE switching screens. Flipping to
  // "table" first and loading after left a brief window where state.hand
  // was still null - table.js reads that as "no active hand" and shows an
  // enabled "Deal next hand" button even when a hand is already in
  // progress (seen during playtesting as a stale "Waiting to deal" flash
  // on rejoin). Loading first means the table screen's first render
  // already has the real hand state.
  setState({ myPlayerId: playerId, error: null });
  await loadRoom(roomId);
  // Remember the room (fast reconnect) and reflect its code in the URL (so the
  // link is shareable and a refresh keeps the room).
  const code = getState().room?.code ?? null;
  persistRoom(roomId, playerId, code);
  setRoomInUrl(code);
  setState({ screen: "table" });
  subscribeToRoom(roomId);
}

export function renderLobby(root) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "lobby";

  const logo = document.createElement("div");
  logo.className = "logo";
  logo.innerHTML = `<h1>PAY ME</h1>`;

  // Built from the same SVG suit icons the cards use, not the Unicode
  // suit characters - see cards.js's suitIcon() comment: those glyphs
  // aren't guaranteed to exist in whatever font a browser falls back to,
  // and silently render as a blank/default-colored glyph instead of
  // triggering a visible fallback (bit us here first on the diamond,
  // which came out a flat gray instead of pink).
  const suits = document.createElement("div");
  suits.className = "suits";
  [
    ["S", "lobby-suit-icon--s"],
    ["H", "lobby-suit-icon--h"],
    ["D", "lobby-suit-icon--d"],
    ["C", "lobby-suit-icon--c"],
  ].forEach(([suit, className]) => {
    const icon = suitIcon(suit);
    icon.classList.add("lobby-suit-icon", className);
    suits.appendChild(icon);
  });
  logo.appendChild(suits);
  wrap.appendChild(logo);

  const card = document.createElement("div");
  card.className = "lobby-card";

  const nameField = document.createElement("div");
  nameField.className = "field";
  nameField.innerHTML = `<label for="displayName">Your name</label>`;
  const nameInput = document.createElement("input");
  nameInput.id = "displayName";
  nameInput.placeholder = "e.g. Hercules Mulligan";
  nameInput.maxLength = 24;
  nameInput.value = readDisplayName();
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  // Character picker: the icon shown for you at the table (see ui/avatars.js).
  const avatarField = document.createElement("div");
  avatarField.className = "field";
  avatarField.innerHTML = `<label>Character</label>`;
  const avatarGrid = document.createElement("div");
  avatarGrid.className = "avatar-grid";
  const avatarBtns = {};
  for (const a of AVATARS) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "avatar-option" + (a.id === selectedAvatar ? " avatar-option--active" : "");
    opt.setAttribute("aria-label", a.label);
    const img = document.createElement("img");
    img.src = a.src;
    img.alt = a.label;
    opt.appendChild(img);
    opt.addEventListener("click", () => {
      selectedAvatar = a.id;
      for (const [id, b] of Object.entries(avatarBtns)) {
        b.classList.toggle("avatar-option--active", id === a.id);
      }
    });
    avatarBtns[a.id] = opt;
    avatarGrid.appendChild(opt);
  }
  avatarField.appendChild(avatarGrid);
  card.appendChild(avatarField);

  const joinField = document.createElement("div");
  joinField.className = "field";
  joinField.innerHTML = `<label for="roomCode">Room code</label>`;
  const codeInput = document.createElement("input");
  codeInput.id = "roomCode";
  codeInput.placeholder = "ROOM CODE";
  codeInput.maxLength = 6;
  codeInput.style.textTransform = "uppercase";
  // Prefill from a shared invite link (?room=CODE).
  codeInput.value = roomCodeFromUrl() || "";
  codeInput.style.letterSpacing = "0.2em";
  joinField.appendChild(codeInput);
  card.appendChild(joinField);

  const joinBtn = document.createElement("button");
  joinBtn.className = "btn btn--primary";
  joinBtn.textContent = "Join table";
  joinBtn.addEventListener("click", async () => {
    // Disable immediately: without this, a double-click (or a slow network
    // making the first click look like it did nothing) fires enterRoom()
    // twice, which calls subscribeToRoom() twice and leaves two redundant
    // Realtime channels open for the same room in this tab.
    joinBtn.disabled = true;
    createBtn.disabled = true;
    setState({ error: null }); // clear any stale error from a previous attempt
    try {
      persistDisplayName(nameInput.value.trim());
      const { roomId, playerId } = await joinRoom(
        codeInput.value.trim(),
        nameInput.value.trim(),
        selectedAvatar,
      );
      await enterRoom(roomId, playerId);
    } catch (e) {
      setState({ error: e.message });
      joinBtn.disabled = false;
      createBtn.disabled = false;
    }
  });
  card.appendChild(joinBtn);

  const divider = document.createElement("div");
  divider.className = "lobby-divider";
  divider.textContent = "or";
  card.appendChild(divider);

  // Game mode: Full Game plays all 11 hands (wild 3 -> K); Quick Mode stops
  // after hand 8 (wild 3 -> 10) for a shorter game.
  const modeField = document.createElement("div");
  modeField.className = "field";
  modeField.innerHTML = `<label>Game mode</label>`;
  const modeToggle = document.createElement("div");
  modeToggle.className = "mode-toggle";
  const modeBtns = {};
  for (const [value, label, sub] of [
    ["full", "Full game", "3 \u2192 K \u00b7 11 hands"],
    ["quick", "Quick", "3 \u2192 10 \u00b7 8 hands"],
  ]) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "mode-option" + (value === selectedMode ? " mode-option--active" : "");
    opt.innerHTML = `<span class="mode-option-label">${label}</span><span class="mode-option-sub">${sub}</span>`;
    opt.addEventListener("click", () => {
      selectedMode = value;
      for (const [v, b] of Object.entries(modeBtns)) {
        b.classList.toggle("mode-option--active", v === value);
      }
    });
    modeBtns[value] = opt;
    modeToggle.appendChild(opt);
  }
  modeField.appendChild(modeToggle);
  card.appendChild(modeField);

  const createBtn = document.createElement("button");
  createBtn.className = "btn btn--secondary";
  createBtn.textContent = "Start a new table";
  createBtn.addEventListener("click", async () => {
    joinBtn.disabled = true;
    createBtn.disabled = true;
    setState({ error: null }); // clear any stale error from a previous attempt
    try {
      persistDisplayName(nameInput.value.trim());
      const { roomId, playerId } = await createRoom(
        nameInput.value.trim() || "Host",
        selectedMode,
        selectedAvatar,
      );
      await enterRoom(roomId, playerId);
    } catch (e) {
      setState({ error: e.message });
      joinBtn.disabled = false;
      createBtn.disabled = false;
    }
  });
  card.appendChild(createBtn);

  wrap.appendChild(card);
  root.appendChild(wrap);
}
