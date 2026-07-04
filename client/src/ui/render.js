import { renderLobby } from "./lobby.js";
import { renderTable } from "./table.js";
import { setState } from "../state/store.js";

export function render(state) {
  const app = document.getElementById("app");
  const errorBanner = document.getElementById("error-banner");

  if (state.error) {
    errorBanner.textContent = state.error;
    errorBanner.classList.add("visible");
  } else {
    errorBanner.classList.remove("visible");
  }

  if (state.screen === "table") {
    renderTable(app);
  } else {
    renderLobby(app);
  }
}

export function wireErrorDismiss() {
  document
    .getElementById("error-banner")
    .addEventListener("click", () => setState({ error: null }));
}
