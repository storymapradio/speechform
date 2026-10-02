# The room: the hook into Studio

`studio/room.js` is the speaker's side of **the room**: a live participants thread for a session. People open
`https://asynchronousinstruments.com/speechform/room?c=CODE` on their phones, see the threads as they grow, react in
one tap (curious, confused, delighted, moved, disagree), add a short line, and tap **explore** on any thread to ask
for more of it. Studio publishes the threads and hears the room back.

It is self-contained. Studio needs four small additions, listed below. Nothing in `room.js` touches Studio's DOM
except the element you give `Room.panel()`, and it draws nothing over the image.

## 1. Include it

After `<script src="/studio/steer.js"></script>`:

```html
<script src="/studio/room.js"></script>
```

`room.js` loads supabase-js and the QR library from jsDelivr only when a room is used.

## 2. Publish the state

At the end of the `try` block in `poll()`, after `drawNext();`:

```js
if (window.Room && SCREEN !== 'stage') Room.publish(S);
```

`Room.publish` accepts Studio's own `S` as it is. It reads `S.steer.threads` (id, title, state, opened_by,
opened_at, last_at), `S.steer.active`, `S.steer.arc` (the current stage's name), `S.steer.talk.questions`
(unanswered ones), `S.steer.hold.meter` (absorption) and the last four `S.transcript` lines. It applies the same
90 s dormant rule as `ST.live`. It sends at most one write every 3 s, and sends sooner when a thread opens or changes
state. Identical states are not resent. Transcript lines leave the Mac only when the host ticks "share the last
lines". The database enforces this too. If the lead form lives somewhere other than `S.steer.arc.kind`, pass it
explicitly: `Room.publish({ ...S, form: S.lead_form })`.

## 3. Show the room on the desk

In the desk markup, add a room box to the side column. One way is to put this line after the
`$('#deskside').append(...)` call:

```js
if (window.Room) { const box = document.createElement('div'); box.id = 'deskroom'; $('#deskside').append(box); Room.panel(box); Room.resume(); }
```

The panel handles everything:

- **The host key.** It asks for a host key, or reads one handed over as `/studio/#sfhost=<key>`, which the
  Engine's "open Studio with this key" button does.
- **Opening a room.** It shows a cohort picker, a title, "guests may join by code" and "share the last lines",
  then **Open the room**.
- **While the room is open.** It shows the code in large type, the QR, the link, and **Copy the link** and
  **Close the room**. Two live toggles follow, then the reactions as a weather band, the tallies, "the room wants
  more of" (threads by interest) and the last thirty posts.

`Room.resume()` reconnects to a room left open when Studio reloads.

For a single-screen Studio, the same panel can sit in a page or sheet of its own: `Room.panel(element)`.

## 4. Feed the steering layer (optional, small)

```js
/* the room's interest per thread, for cues and the next move */
const room = window.Room ? Room.summary() : null;
// room.threads[id] = { label, votes, posts, reactions: { curious: n, ... }, interest }   interest halves every 3 min
// room.wants = thread ids, most wanted first;  room.recent = reactions in the last two minutes;  room.weather = 15 s bins
```

Suggested uses:

- In `threadCues()`, add `want: Math.min(1, (room?.threads[t.id]?.interest || 0) / 3)` so a thread the room wants
  glows a little brighter at its tip in Nudge and Guide.
- In `candidates()` or the next-move card, when `room.wants[0]` is a dormant or ready thread, offer to return to it:
  "The room wants more of “<label>”."
- When the confused share of `room.recent` crosses one third, offer a slower, concrete line. When delighted or moved
  leads, keep holding the thread in play.
- `Room.onFeedback(post => activity())` flashes the desk when a post arrives.
- `Room.weather(canvas)` draws the reaction band on any canvas. Call it from `Room.onChange` or on each desk frame.

## The API

| Call | Does |
| --- | --- |
| `Room.open({ cohortId, title, allowGuests, shareTranscript })` | opens a room for a cohort the host facilitates and closes that host's earlier open room in the same cohort; resolves to `{ id, code, url, ... }` |
| `Room.publish(stateObj)` | shares the state (Studio's `S`, or `{ form, arc, absorption, threads: [{ id, label, state, speaker, started_at, active }], questions, lines }`) |
| `Room.onFeedback(fn)` | `fn({ id, kind, text, thread_id, author_name, created_at })` for each new post |
| `Room.onChange(fn)` | `fn(summary)` on any feedback, vote or room change |
| `Room.summary()` | per-thread interest and reaction tallies over time |
| `Room.panel(el)`, `Room.weather(canvas)` | the desk panel, and the weather band alone |
| `Room.set({ allowGuests, shareTranscript, title })`, `Room.close()`, `Room.status()`, `Room.resume()` | room controls |

## How hosting works

Studio runs at 127.0.0.1, where the site's sign-in session does not reach. A facilitator therefore makes a **host
key** in the Engine (`/engine#/rooms`, "a key for Studio"). The key is shown once, stored here in `localStorage`
(`sf-host-key`), and sent only to the `sf_host_*` functions. The key can be revoked in the Engine.

The data lives in the Supabase project `nqelzijdjgpvzcczfvvy`, in `sf_rooms`, `sf_room_state`, `sf_feedback`,
`sf_votes`, `sf_room_guests` and `sf_host_keys`. Live updates travel on a broadcast topic named by the room's secret channel key, so
guests and this Mac hear them without a session.
