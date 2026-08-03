// The character icons a player can pick in the lobby. The value stored on the
// player row (players.avatar, set via create-room/join-room) is the `id`
// (e.g. "av1"); this list maps that id to its image asset. Add, remove, or
// reorder entries here to change the roster - the lobby picker, the table
// seats, and the winner celebration all read from this one place.
export const AVATARS = [
  { id: "av1", src: "/assets/avatars/av1.jpg", label: "Character 1" },
  { id: "av2", src: "/assets/avatars/av2.jpg", label: "Character 2" },
  { id: "av3", src: "/assets/avatars/av3.jpg", label: "Character 3" },
  { id: "av4", src: "/assets/avatars/av4.jpg", label: "Character 4" },
  { id: "av5", src: "/assets/avatars/av5.jpg", label: "Character 5" },
  { id: "av6", src: "/assets/avatars/av6.jpg", label: "Character 6" },
  { id: "av7", src: "/assets/avatars/av7.jpg", label: "Character 7" },
];

/** Resolve a stored avatar id to its image src, or null (fall back to initials). */
export function avatarSrc(id) {
  const found = AVATARS.find((a) => a.id === id);
  return found ? found.src : null;
}

/**
 * Warm the browser cache with every avatar image up front. The table rebuilds
 * its DOM on each state change, so an avatar <img> gets recreated often;
 * preloading means those recreations paint from cache instantly instead of
 * flashing while the image re-decodes.
 */
export function preloadAvatars() {
  for (const a of AVATARS) {
    const img = new Image();
    img.decoding = "async";
    img.src = a.src;
  }
}
