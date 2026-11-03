# Aurelia

“Turn a quiet alien planet into a living home—and discover what was here before you.”

Aurelia is a gentle building experience for desktop browsers and Meta Quest 3 / 3S. It uses TypeScript, Three.js, Vite and WebXR, with procedural scenery and local saves. No headset app, backend, account or paid service is required to play.

## A Light in the Dark

Choose **Begin your story** to start in a clear area. The chapter follows one objective at a time:

1. Place your first habitat anywhere suitable inside the grid.
2. Add a solar array. One array powers the whole settlement, illuminating its habitat windows; there is no wiring simulation.
3. Build a greenhouse and plant **Sunleaf** (amber leaves) or **Moonbloom** (violet flowers). Watch the plants grow and native life appear nearby.
4. Prepare a landing pad, then choose **Activate beacon** when the current habitat, power, planted greenhouse and pad are all present.
5. Watch the arriving ship and meet PIP, your first explorer companion.
6. Name your home and keep building. The observatory unlocks after the visitor arrives.

The chapter aims for around 10–15 minutes of relaxed, self-paced play; a direct playthrough can be shorter. There are no resource timers or required idle periods. The final “Beyond the ridge, something answers” line is a story hook, not a playable second quest.

The story starts empty with 24,000 credits and returns the full construction cost when you reclaim a building. Construction choices unlock progressively. You can rotate, reclaim and undo while learning; if you remove a prerequisite, the objective explains what needs restoring. Historical milestones remain acknowledged, but the beacon always checks the buildings that exist now. There are no repeatable milestone credit rewards.

**Free build** remains available with all five building types. Its six-building starter outpost costs 1,040 credits, leaving 22,960 from the existing 24,000-credit allowance. Free-build reclamation still refunds 75%.

## Saves and settings

Returning players see **Continue** first. Story and Free build have separate local slots: starting or continuing the story keeps your Free build settlement. Saves include the mode, world, milestone history, live planting state, settlement name and visitor status.

Version-1 worlds migrate into Free build. The original `aurelia.world.v1` browser-storage entry is retained; the version-2 library uses `aurelia.saves.v2`. Exported version-1 world files can also be imported as Free build worlds. New exports include the active world's mission state. Import validates the entire file before replacing its corresponding mode's settlement; export a backup before replacing a save you want to keep.

Undoing an import restores the previous playthrough in full. If the saved library cannot be read, imports open for the current session only and leave the original stored bytes untouched; export a backup to keep that session.

Milestones and the visitor cannot be duplicated through undo or reload. Reclaiming and undoing a greenhouse also restores its live planting state consistently. Reloading during the ship approach restarts the short arrival animation; reloading after arrival restores the companion. Entering or exiting VR does not reset the mission.

Browser storage belongs to the browser and site address, so desktop and Quest saves do not synchronize. Clearing browser data can erase local saves. Use **Export** and **Import** to keep backups or transfer a settlement. Storage failures are reported on screen and in the headset HUD.

Sound cues are **muted by default** and require a user action to enable. Every objective is understandable without audio. Reduced motion respects the initial system preference and can be selected in the app; it shortens or removes decorative movement and growth/arrival transitions.

## Try it on your Quest

The headset needs an **HTTPS address**. A desktop development address is not a headset deployment.

1. Commit and push the project, including its lockfile and workflow, to `vrmaria27/vrtest1` on `main` when ready to publish.
2. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source. GitHub Pages must be available for the repository and account.
3. Open **Actions → Deploy Aurelia → Run workflow** and select `main`.
4. After deployment succeeds, open the deployment's URL in **Meta Quest Browser**. The default Pages URL is `https://vrmaria27.github.io/vrtest1/`.
5. Connect both controllers, select **Enter VR**, and allow the immersive-session prompt.

The existing workflow is manual-only. Building the app does not publish it. For another static HTTPS host, run `npm run build` and upload the contents of `dist/`, including `index.html` and `assets/`.

Inside VR, point the right controller at the lower HUD and use the right trigger for story choices, planting, beacon activation, naming presets and other visible actions. Construction and movement controls remain unchanged. See [Quest setup and controls](docs/QUEST.md).

## Develop and validate

Use Node.js 22 or later and npm. Cloud tasks already have isolated workspaces; use the existing checkout instead of creating another Git worktree.

```sh
cd /workspace/vrtest1
npm ci
npm run dev
```

```sh
npm test          # World, mission, migration, storage and mocked XR rules
npm run build    # Type checking and production build
npm run test:e2e # Playable mission and Free build browser checks
```

Browser tests use `/usr/bin/chromium` when available. Otherwise install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. `npm run preview` serves a production build for local checking.

Automated XR tests use mocked input sources. Physical Quest tracking, button mapping, comfort, visual scale and sustained frame rate still require a headset playtest; automated checks do not establish those results.

### Short manual playtest

- **Desktop:** Begin a new story, place and rotate a habitat, add power, choose a plant variety, reclaim a prerequisite and undo, then restore it and activate the beacon. Name the settlement, reload, and confirm PIP remains. Switch to Free build and confirm its independent settlement; export and re-import a backup.
- **Quest:** Complete the same loop with the controller HUD. Check planting, beacon and naming actions without desktop overlays; teleport and snap turn; look toward the arrival beam without any forced camera movement; enter and exit VR, mute sound, and try reduced motion. Record comfort and performance separately.

## Scope

This release is single-player. PIP is a persistent visual companion, not a character with complex AI. There is no survival simulation, combat, production economy, second quest, multiplayer, account system or cloud synchronization. [Architecture and the multiplayer path](docs/ARCHITECTURE.md) describes the reusable boundaries and future work.
