# Manual multiplayer test checklist

Automated coverage (`npm test`, 59 tests) proves the game rules are correct
in isolation: melds, wild rotation, scoring, going out, lay-off. It cannot
prove that two separate browsers actually see the same table in real time,
that RLS really blocks what it should, or that the deployed Edge Functions
behave the same as the local logic. That's what this checklist is for.

Run this after each deploy to the real Supabase + Vercel project, using at
least two browser sessions (two different browsers, or one regular + one
private/incognito window, so they get different anonymous auth identities).

## Setup

- [ ] `client/src/config.js` has the real `SUPABASE_URL` / `SUPABASE_ANON_KEY`
- [ ] Anonymous sign-ins are enabled in Supabase Auth settings
- [ ] Migration `0001_init.sql` has been applied to the project
- [ ] All Edge Functions are deployed
- [ ] The Vercel deployment is serving `client/index.html`

## Lobby & room lifecycle

- [ ] Browser A creates a room, gets a room code, lands on the table screen as the only seated player
- [ ] Browser B joins with that code and a different display name; both browsers show 2 players within a couple seconds without refreshing
- [ ] Refreshing Browser B keeps it seated in the same spot (rejoin-by-seat), not a duplicate seat
- [ ] A third/fourth browser can join the same room; seat order matches join order
- [ ] Joining with a wrong/nonexistent code shows an error, not a crash
- [ ] Joining a room that's already `in_progress` is rejected with a clear error
- [ ] A 9th player is rejected (max 8)

## Dealing & wild rotation

- [ ] "Deal hand 1" deals 3 cards to each player and flips one upcard; both browsers see the same upcard
- [ ] The wild rank shown is "3" on hand 1
- [ ] After a full hand completes and "Deal next hand" is used, hand 2 deals 4 cards and the wild rank shows "4" - continue spot-checking through at least hand 6 to confirm the 3→4→5→6→7→8 progression
- [ ] With 2 players in the room, an appropriate two-deck-sized stock is used (verify by drawing through most of the stock without the app breaking); with 5+ players, confirm a third deck's worth of cards exist (harder to verify directly - at minimum confirm no errors dealing hand 11 at 13 cards each with 5+ players)

## Turn play

- [ ] Only the current turn's player has enabled Draw buttons; other players' controls are disabled
- [ ] Drawing from stock removes the top stock card into that player's hand only (opponents see the drawn card is invisible, just the card count for that seat unchanged then... actually card count +1 until they discard)
- [ ] Drawing from discard takes the visible top discard card
- [ ] Attempting to draw twice in one turn is blocked (button disabled after first draw)
- [ ] Discarding without drawing first is blocked
- [ ] After discarding, turn passes to the next seat and that seat's controls become enabled
- [ ] Selecting 3+ cards and clicking "Meld as set" succeeds for a genuinely valid set, and the melded cards disappear from hand and appear on the table for both browsers
- [ ] The same selection sent as a run is rejected if the cards aren't actually a run (and vice versa)
- [ ] An invalid meld (e.g. mismatched ranks) shows a clear error and nothing changes
- [ ] Selecting one card from hand and clicking an existing meld lays it off; both browsers see the meld grow

## Disconnect handling

- [ ] Close Browser B's tab mid-game (simulating a dropped connection) while it's B's turn; after the expected turn transition, the game does not stall waiting on B forever (seat shows disconnected, turn is skippable per the auto-skip design)
- [ ] Reopening the room in a new tab logged in as the same browser profile rejoins B's seat and its hand is intact

## Going out / Pay Me / lay-off / scoring

- [ ] Play (or engineer, by discarding down) a hand to where one player melds everything but one card and discards it - the "Pay Me!" banner appears for all browsers
- [ ] Every other player gets exactly one more turn (draw + discard), not more
- [ ] After the last final turn, the lay-off phase begins and remaining players can add cards to any meld, including melds they don't own
- [ ] Passing lay-off for the last remaining player transitions to scoring; hand scores appear correctly (caller = 0, others = sum of remaining card values, wild/joker cards = 0)
- [ ] Cumulative score across hands adds up correctly for at least 3 consecutive hands
- [ ] The Pay Me tally (separate from cumulative score) increments correctly for whoever calls it, independent of who's winning on score

## Full game

- [ ] Play all 11 hands to completion in one sitting with at least 2 players; the room ends up `complete` and dealing further hands is blocked
- [ ] Final standings show the lowest cumulative score as the winner and the most Pay Me calls as a separate honor

## Security spot-checks

- [ ] Open browser dev tools on one session and confirm a direct Supabase REST query for another player's `hand_players.hand_cards` returns nothing (RLS blocking it)
- [ ] Confirm the stock (`hand_stock` table) is not fetchable from the browser under any query
