# SDK compatibility

Radar requires SDK 0.6.104 or later. The bot work control uses a header thread action and opens the fixed Bot tab with `experimental_panel.openTab`. BB owns the header button and its compact-screen menu placement. Reminder actions open their registered action tab through the same controller.

The nightly switch validates a git archive with an SDK source symlink into a separate bb checkout. That SDK checkout has its own React declarations; React ref cleanup types contain a private unique symbol and cannot cross between the two copies. TypeScript paths resolve React and React DOM declarations, including their subpaths, from Radar's dependencies for the entire check. Runtime React still comes from BB's build shims. No ref casts or discarded refs are needed.

Validate both with the installed `bb plugin types` / `npm run typecheck` / `bb plugin build` and the switch's archive, npm install, SDK symlink, typecheck and staged CLI build sequence. Do not run the nightly switch with `--apply` as part of Radar verification.
