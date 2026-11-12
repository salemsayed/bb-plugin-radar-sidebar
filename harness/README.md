# Bot panel scenario harness

Renders Radar's real bot components (`BotsView`, the bot panel it opens, and the Bot tab) in a plain browser page, with fixture data shaped like core's live `bot_tasks`, so a change to the panel can be seen in every state before it ships.

Nothing here is part of the plugin build: `harness/` has its own `package.json`, and `bb plugin build` never imports it.

## Use

```sh
cd harness
npm install
npm run serve        # http://127.0.0.1:4173 lists every scenario, with desktop, phone, dark and Bot tab links
npm run shoot -- --out shots
```

`shoot` builds, then saves for every scenario a desktop and an emulated touch phone screenshot (`<id>-<view>.png`), the whole panel unscrolled (`-full.png`), the panel's text (`.txt`) and `index.json` with how many screens of scrolling each one needs. Options: `--only <id,id>`, `--themes light,dark`, `--views desktop,phone`, `--surface tab` for the Bot tab, `--expanded` to also open every row's details. It exits 1 if a page logs an error. It uses the Chrome at `HARNESS_CHROME`, else the system one.

## How it works

- `src/sdk.tsx` stands in for `@get-bb/plugin-sdk/app` (aliased in `build.mjs`). It answers the RPC calls and thread lists Radar makes from `src/world.ts`, which holds the current scenario.
- `src/build.ts` has the fixture builders. Task lines are written the way core's `projection.ts` writes them, and the result is parsed by Radar's own `botTasksSchema`, so a fixture that drifts from the schema fails typecheck or parse.
- `src/scenarios/` holds the scenarios. Each has an `id`, a title, one sentence on what to look for, and a sketch of the bot. Add one by adding an entry; it appears in the index and in `shoot`.
- The clock is frozen at Thu 12 Nov 2026, 13:40 Cairo (`src/clock.ts`), so screenshots are comparable between runs.
- `theme/bb.css` is bb's own base layer, theme variables and Inter, captured from a running bb. After a bb update run `npm run theme` (reads `BB_SERVER_URL`, default `http://127.0.0.1:38886`; read-only).
