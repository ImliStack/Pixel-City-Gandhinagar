# Engagement ideas · 26 October 2026

What would make people come back to a map of Gandhinagar, and play with each other on it? Ideas below are ranked by **fun ÷ effort** for *this* map: one fixed illustrated image (no editable city), ~750 named places in `metadata.json`, anonymous visitors, and a small Cloudflare Worker + Durable Object budget.

## What the references teach

The notes below summarise well-known design patterns. They are not a new source-by-source study.

- **SimCity (1989 → 2013).** The 1989 design docs present the city as a toy with no win state: players set their own goals, and the joy is in *observing* systems. The 2013 always-online regions showed that shared multiplayer state is fragile and frustrating when it fails. *Lesson:* make the map a toy you poke at, and keep anything shared optional, so the map still works when the server is down.
- **Cities: Skylines.** Info-view overlays such as traffic, noise and land value turn one map into many readings. The Workshop shows that user-made content keeps people around. *Lesson:* our layers and filters are already "info views". Trivia and hunts can sit on top of them.
- **Townscaper.** No goals, instant feedback, and every click looks good. *Lesson:* tiny actions with charming pixel feedback beat complex rules.
- **GeoGuessr.** You get a clue image, you guess a location on the map, and your score falls off with distance. The daily challenge and shareable score built its social reach. *Lesson:* our map *is* the answer sheet, and our tiles already are the clue images.
- **r/place.** A shared, scarce action (one pixel every N minutes) creates coordination, factions and stories. *Lesson:* scarcity plus a shared canvas works, but it needs moderation (text and symbols can be abused).
- **Pokémon Go.** Real places become content, and people go and *visit*. *Lesson:* real POIs (temples, parks, metro stations) can be collectibles, but we must never require physical presence or collect location data.
- **Wordle.** One puzzle per day, the same puzzle for everyone, an emoji-grid share, and no spoilers. *Lesson:* a daily cadence plus a spoiler-free share string is the cheapest way to get return visits.

## Ranked ideas

Fun and effort are scored 1–5. Rank is fun ÷ effort, adjusted for risk.

| # | Idea | Fun | Effort | Notes |
| --- | --- | --- | --- | --- |
| **1** | **Daily "Find the landmark"** (GeoGuessr × Wordle). Each day gives everyone the same 3 places. The clue is a close-up tile crop. You pan a crosshair onto the spot and get scored by ground distance. After you guess, you see other visitors' guesses as their pixel faces. There is a daily board and a copyable 🟩🟨🟧🟥 result. | 5 | 2 | **Implemented.** Reuses tiles, POIs, the presence channel and avatars. No new assets or moderation. Degrades to solo play offline. |
| 2 | **Live cursors / "who's looking where"**: each visitor's face drifts on the minimap and map at their view centre. | 4 | 2 | Cheap on the same heartbeat (add `cx, cy, z`). Privacy is fine because only map positions are shared. Coarse polling (4 s) makes movement jumpy, so it needs a WebSocket on the DO to feel live. Best next step. |
| 3 | **Scavenger hunt over real POIs**: themed lists such as "5 temples", "every metro station" or "Sector 1–30 gardens". Clicking a found place stamps it with a pixel badge. Progress is local, and a shared counter shows "312 visitors finished the metro hunt". | 4 | 2 | Builds on categories already in `metadata.json`. Mostly UI. |
| 4 | **Sector trivia**: tap a sector to get a 1-question card (e.g. "Which sector has Akshardham?"). It uses the `neighbourhood` POIs, with a streak counter. | 3 | 2 | Questions must be written by hand or generated from data with checks, because a wrong fact is worse than no fact. |
| 5 | **Pixel flags (shared board)**: drop one 12×12 flag per day at a spot with a preset emoji or icon (no free text), visible to all. | 4 | 3 | r/place energy, but needs abuse controls: rate limits per id, preset symbols only, decay after 7 days, and a report button. Feasible on a DO, but moderation is the real cost. |
| 6 | **Photo-mode postcards**: frame a view, pick a layer (night, monsoon), add a caption from a preset list, and export a PNG with attribution. | 3 | 2 | Single-player and shareable. Needs canvas compositing of tiles (same-origin, so this is OK). |
| 7 | **Guided tours / "story walks"**: an authored camera path with captions (Capital Complex, Dandi Kutir, the Sabarmati). | 3 | 3 | Mostly content work. Great for schools. |
| 8 | **City-builder sandbox** (place parks or metro stops on the map). | 4 | 5 | The image is pre-rendered, so building on it would need re-rendering or sprite overlays. Out of scope. |

## Why #1 first

- It uses only what exists: tiles as clues, curated and named POIs as answers, `groundMeters()` from the camera transform for honest distances, and the presence channel and faces for the multiplayer reveal.
- It is the same for everyone, so it is shareable, and it needs no moderation because there is no user text.
- It is spoiler-free: the server sends other players' guesses for a round only after you have guessed it.
- Trade-off: scores are computed in the browser and clamped server-side, so a determined cheater can post 5000s. That is acceptable for a friendly board. If needed, the fix is to give the Worker the answer list (it would need the daily puzzle and the POI images).

## Implementation map

- `apps/viewer/shared/daily.mjs`: puzzle choice (IST day seed), distance, score, clue tiles.
- `apps/viewer/shared/social-core.mjs`: room state (presence TTL, visit total, per-day board). It is shared by `vite.config.ts` (dev middleware, in memory) and `deploy/cloudflare/worker.mjs` (Durable Object + optional KV mirror).
- `apps/viewer/src/social.ts`: a 4 s heartbeat hook that goes quietly offline when the API is absent.
- `apps/viewer/src/DailyGame.tsx`: game UI. `icons.tsx` `PixelFace` renders the avatars from `shared/avatar.mjs`.
