import { ensureSession, currentUserId } from "./network/supabaseClient.js";
import { subscribe, getState, setState } from "./state/store.js";
import { render, wireErrorDismiss } from "./ui/render.js";

async function boot() {
  await ensureSession();
  const userId = await currentUserId();
  setState({ userId });

  subscribe(render);
  wireErrorDismiss();
  render(getState());
}

boot().catch((e) => {
  console.error(e);
  document.getElementById("app").innerHTML =
    `<div class="lobby"><div class="lobby-card"><p>Couldn't connect: ${e.message}</p></div></div>`;
});
