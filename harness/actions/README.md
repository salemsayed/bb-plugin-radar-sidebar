# Bot panel actions harness

Presses every control in Radar's bot panel against a real core, in a throwaway bb, and checks what really happened: what core recorded, which message landed in which chat and whether it reads as Salem's answer, where the page went, and what the panel shows afterwards and after a reload. It runs on a desktop window and an emulated touch phone.

The looks harness one folder up (`harness/`, `npm run shoot`) renders the panel from fixtures. This one never uses fixtures: every task, question, desk and Not now is made through core's own commands and the panel's own buttons.

## Run

```sh
cd harness
npm install
npm run actions                       # both views, the Radar and core builds the live bb has installed
npm run actions -- --views phone      # one view
npm run actions -- --radar <dir> --core <dir>   # point at other builds
npm run actions -- --only later,desks --case not-now
```

Results go to `harness/actions/results/` (or `--out <dir>`): `results.md` (view × scenario × action, pass or fail, evidence, screenshot), `results.json`, `run.log`, `world-<view>.json` (the ids of everything seeded) and one screenshot per case. It exits 1 when any case fails.

A build is a plugin folder with its `dist/` built, such as a release under `~/.local/share/bot-releases/`. `candidate.sh <checkout or worktree> <out dir> [commit]` builds one from a commit the way `bb-deploy` does (git archive, the checkout's `node_modules`, `bb plugin build`). By default the run copies the folders the live bb has installed for `radar-sidebar`, `orchestrator-mode` and `genui` (read from the live bb's database, read-only), and copies Salem's live Radar settings.

## The test bb

- Its own data, ports and processes: `~/.cache/bb-tmp/radar-actions-iso` (`PANEL_ISO`), server 49566, host daemon 49568 (`PANEL_SERVER_PORT`, `PANEL_DAEMON_PORT`), the same bb version the live bb runs. Every CLI call goes through `env -i` with that data dir and server, so nothing reaches the live bb. `start.sh` and `stop.sh` start and stop it; `stop.sh` only stops a process group whose bb-app uses that data dir.
- Every run wipes that folder and starts fresh. `--reuse` skips setup and seeding and presses on the world the last run left (for working on a case only; cases change the world).
- Stand-ins, installed only in the test bb (`stand-ins/`):
  - `echo-provider`: bb's scripted echo provider. `say_file:<path>` replies with that file's text, so a test bot can post an exact card; `hold_turn` keeps a worker running; `ask_user` opens a native question.
  - `judge`: plugin id `auto-effort`. Its `jev_decide` judges a bot's final result supported (so a task can finish) and refuses every other question as if Jev were down. Answer judging is therefore off in a build that still has it (the core before the one-path rebuild); the rebuilt core judges no answers at all: a question closes on a button or form answer, his exact option text, a message naming it, Not now, a newer version, the bot's own `bb saelmbot question close`, or its source ending.
  - `automations`: plugin id `saelmbot-automations`, only the desk route; a desk prompt containing `no_capacity` is refused, so core defers that desk.
  - `clock.mjs`: started with `PANEL_CLOCK_OFFSET_MS`, the test bb runs that far in the past. Setup seeds at two days ago, yesterday and 13 hours ago, restarting bb between them, then seeds the present. That is how done history, old asks, overdue checks and failed checks get real timestamps.
- Every scenario is its own registered bot (Buttons Bot, Later Bot, Desk Bot, …) on the echo provider, so one scenario's answers never lock another's cards.

## Files

- `run.mjs`: setup, seeding, then every case per view, then the results.
- `lib/world.mjs`: the scenarios and what each seeds in each phase.
- `lib/seed.mjs`: seeding verbs over core's commands (task create/change, workers, desks, needs, cards).
- `lib/cases.mjs`: the cases. Each presses controls and returns checks; `owner` marks a case that records a known fault left to its owner (for example the Needs you pipeline) instead of a panel fault.
- `lib/panel.mjs`: the browser driver (open a bot's panel, read the panel's state, press or tap, double tap, where the page went, the composer).
- `lib/bb.mjs`: the test bb's CLI and read-only database access.
- `lib/setup.mjs`: wipe, start, install builds and stand-ins, settings.
