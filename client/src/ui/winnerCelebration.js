// The game-over celebration: when the final (11th) hand is scored and the
// room flips to "complete", the champion's name flickers on like the lobby's
// neon "PAY ME" sign, suit-colored confetti rains, and the full final
// standings float up beneath so every player sees where they landed.
//
// Mounted straight onto <body> (never inside #app) on purpose: renderTable()
// wipes #app on every setState, so anything parented there would have its
// entry animation restarted on the next realtime tick and its confetti
// regenerated. Living on <body> keeps this a one-shot moment, untouched by
// the render loop. It's triggered once, from loadRoom()'s observed
// in-progress -> complete transition (see network/queries.js).
import { getState } from "../state/store.js";
import { loadStandings } from "../network/queries.js";

const OVERLAY_ID = "winner-celebration";
const CONFETTI_COLORS = [
  "#ff3d8a",
  "#3de0ff",
  "#c8ff3d",
  "#ffb852",
  "#ff2d2d",
  "#ffb8ff",
  "#00ffff",
  "#ffaa00",
];

export async function showWinnerCelebration(roomId) {
  // Pull the freshest cumulative standings before announcing the winner;
  // if that read fails for any reason, fall back to whatever's in state.
  try {
    await loadStandings(roomId);
  } catch (_e) {
    /* fall through with existing state.standings */
  }
  mountCelebration();
}

function mountCelebration() {
  const standings = getState().standings ?? [];
  if (standings.length === 0) return; // nothing to celebrate without results

  // Replace any prior instance so a re-trigger can never stack overlays.
  document.getElementById(OVERLAY_ID)?.remove();

  const winner = standings[0];

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "wc-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Game over. ${winner.displayName} wins.`);

  const confetti = document.createElement("div");
  confetti.className = "wc-confetti";
  overlay.appendChild(confetti);

  const rise = document.createElement("div");
  rise.className = "wc-rise";

  const eyebrow = document.createElement("div");
  eyebrow.className = "wc-eyebrow";
  eyebrow.textContent = "CHAMPION";
  rise.appendChild(eyebrow);

  const name = document.createElement("div");
  name.className = "wc-name";
  name.textContent = winner.displayName; // textContent: names are user input
  rise.appendChild(name);

  const table = document.createElement("div");
  table.className = "wc-table";
  standings.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = i === 0 ? "wc-row wc-win" : "wc-row";
    row.style.setProperty("--d", `${1.5 + i * 0.16}s`); // staggered reveal

    const rk = document.createElement("span");
    rk.className = "wc-rk";
    rk.textContent = String(i + 1);
    row.appendChild(rk);

    const nm = document.createElement("span");
    nm.className = "wc-nm";
    nm.textContent = entry.displayName;
    row.appendChild(nm);

    const bd = document.createElement("span");
    bd.className = "wc-bd";
    bd.textContent = entry.payMeWins > 0 ? `★ ${entry.payMeWins}` : "";
    row.appendChild(bd);

    const sc = document.createElement("span");
    sc.className = "wc-sc";
    sc.textContent = String(entry.cumulativeScore);
    row.appendChild(sc);

    table.appendChild(row);
  });
  rise.appendChild(table);

  const actions = document.createElement("div");
  actions.className = "wc-actions";

  const again = document.createElement("button");
  again.className = "wc-cta";
  again.textContent = "Play again";
  // No room is persisted across a reload, so this lands back on the lobby
  // with a clean slate to create or join the next table.
  again.addEventListener("click", () => location.reload());
  actions.appendChild(again);

  const viewTable = document.createElement("button");
  viewTable.className = "wc-close-link";
  viewTable.textContent = "View final table";
  viewTable.addEventListener("click", dismiss);
  actions.appendChild(viewTable);
  rise.appendChild(actions);

  overlay.appendChild(rise);

  const closeX = document.createElement("button");
  closeX.className = "wc-close";
  closeX.setAttribute("aria-label", "Close");
  closeX.textContent = "✕";
  closeX.addEventListener("click", dismiss);
  overlay.appendChild(closeX);

  // Clicking the backdrop (but not the content) dismisses too.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  document.body.appendChild(overlay);
  spawnConfetti(confetti);

  function dismiss() {
    overlay.remove();
  }
}

function spawnConfetti(box) {
  for (let i = 0; i < 46; i++) {
    const pip = document.createElement("div");
    pip.className = "wc-pip";
    pip.style.left = `${Math.random() * 100}%`;
    pip.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const dur = 2.6 + Math.random() * 2.4;
    const delay = Math.random() * 1.8;
    pip.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    pip.style.animation = `wc-fall ${dur}s linear ${delay}s infinite`;
    if (Math.random() < 0.5) pip.style.borderRadius = "50%";
    box.appendChild(pip);
  }
}
