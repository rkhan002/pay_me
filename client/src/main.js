import { ensureSession, currentUserId } from "./network/supabaseClient.js";
import { subscribe, getState, setState } from "./state/store.js";
import { render, wireErrorDismiss } from "./ui/render.js";
import { initAudio, unlockOnFirstGesture } from "./audio/audioManager.js";

async function boot() {
  await ensureSession();
  const userId = await currentUserId();
  setState({ userId });

  initAudio();
  // Browsers refuse to play any audio before the page has seen a genuine
  // user gesture - listening for the very first click/keydown anywhere
  // (rather than only the lobby's join/create buttons) means the music
  // still starts correctly even on a reload straight into an in-progress
  // room. Removes itself after firing once; unlockOnFirstGesture() itself
  // is also idempotent as a second safety net.
  const unlock = () => {
    unlockOnFirstGesture();
    document.removeEventListener("click", unlock);
    document.removeEventListener("keydown", unlock);
  };
  document.addEventListener("click", unlock);
  document.addEventListener("keydown", unlock);

  // Keyboard QoL: Escape closes whichever modal is open (wild picker
  // takes priority over the standings sheet). Additive - the click/close
  // buttons still work; this just gives keyboard users a way out.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const st = getState();
    if (st.wildPicker) setState({ wildPicker: null });
    else if (st.showStandings) setState({ showStandings: false });
  });

  subscribe(render);
  wireErrorDismiss();
  render(getState());
}

boot().catch((e) => {
  console.error(e);
  document.getElementById("app").innerHTML =
    `<div class="lobby"><div class="lobby-card"><p>Couldn't connect: ${e.message}</p></div></div>`;
});
