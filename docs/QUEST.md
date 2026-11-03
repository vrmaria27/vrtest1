# Quest setup and controls

## Open your world

Use the current **Meta Quest Browser** on Quest 3 / 3S with two tracked controllers. Open the deployed **HTTPS** URL in a normal browser tab, wait for loading, then choose **Enter VR** and allow the immersive-session prompt. The default GitHub Pages address is `https://vrmaria27.github.io/vrtest1/` after a successful manual deployment.

WebXR requires a secure context. A normal `http://` computer LAN address does not satisfy that requirement on the headset. Use the [manual HTTPS deployment steps](../README.md#try-it-on-your-quest); building or running the local server does not publish the site.

## Play A Light in the Dark

Choose **Begin your story**, or **Continue** for a saved settlement. **Free build** is a separate mode and keeps its own settlement.

The lower headset HUD contains the current objective, chapter progress and available actions. **Point the right controller at a HUD button and press its trigger** to start/continue, choose plants, activate the beacon, select a settlement-name preset, undo, or use other displayed options. A disabled action does not place a building behind the panel. Story actions do not require desktop DOM overlays.

Follow the habitat → solar array → greenhouse → planting → landing pad → beacon loop. One solar array powers the whole settlement without wires. Choose amber **Sunleaf** or violet **Moonbloom**, then prepare a welcome. The incoming ship is marked at the landing pad; look toward it at your own pace. The app does not turn your camera. PIP remains after arrival, and the observatory unlocks for continued building.

You can choose a settlement-name preset from the headset HUD after the visitor arrives. Use the desktop name field for a custom typed name. The final mystery line introduces no second playable quest.

Story reclaims refund 100%; Free build retains its 75% refund. If you reclaim a required building, the next objective explains what needs restoring. Undo and VR entry/exit preserve historical progress and the single visitor. Reload during an approach restarts its short visual animation; reload after arrival restores the companion.

## In VR

| Input | Action |
| --- | --- |
| Point the right controller at terrain | Preview a building site |
| Right trigger over terrain/buildings | Place a building, or reclaim the pointed building in reclaim mode |
| Right trigger over a HUD action | Select that action |
| A / X | Next / previous unlocked building type |
| B | Switch between build and reclaim modes |
| Y | Rotate the preview a quarter turn |
| Push the left thumbstick, aim the left controller, then release | Teleport to the indicated empty terrain |
| Right thumbstick left / right | Turn in 30° steps |

The HUD also shows credits and feedback, including save failures. Use its visible actions and Journey options for settings. Audio starts muted; all guidance is visual. Enable sound only if wanted. Reduced motion shortens or removes decorative movement and transitions without changing progression. The initial setting respects the system preference.

The initial arrival area stays clear of construction. Teleportation and snap turns avoid continuous camera travel. Use your headset's normal system controls to leave immersive mode. Hand tracking is not supported.

## On a desktop

| Input | Action |
| --- | --- |
| Click an empty grid site | Place a building |
| Drag | Orbit |
| Scroll | Zoom |
| 1–5 | Select the corresponding available building type |
| R | Rotate |
| D / B | Reclaim / build mode |
| Ctrl / Cmd + Z | Undo |

Use the mission's visible choices to plant and activate the beacon, then type a custom settlement name after arrival. Sound and reduced-motion options are available on screen. Export includes the active mode's mission progress; import validates the file before replacing its corresponding slot, while keeping the other mode. Export a backup before replacing something you want to retain.

## Short physical playtest

Automated XR checks use mocked sources; physical Quest tracking, control mapping, visual scale, comfort and sustained frame rate remain unverified until this checklist is performed on hardware.

1. Begin or continue Story entirely through the controller HUD; read each objective at a comfortable distance.
2. Place and rotate a habitat, power it, build a greenhouse and choose either plant variety. Check the windows and growth/native-life feedback with sound muted.
3. Reclaim a prerequisite, read the repair instruction, and undo. Check that historical acknowledgements do not repeat.
4. Place a landing pad, activate the beacon through the HUD, look toward the arrival beam, meet PIP and select a settlement-name preset.
5. Teleport and snap turn before and after arrival. Enter/exit VR and reload; confirm the city and companion persist.
6. Try reduced motion and optional sound. Switch to Free build and confirm Story remains available. Record headset/browser version, comfort, readability and frame rate separately.

## If VR does not start

- Use the deployed `https://` address in a normal **Meta Quest Browser** tab. Another app's embedded browser may not support immersive WebXR.
- Update the headset/browser, connect both controllers and check immersive-session permissions before retrying.
- If VR is unavailable, desktop play remains available. Record the browser/headset version and exact displayed error for diagnosis.
- If the page or assets are missing, confirm that manual deployment succeeded and the entire `dist/` output was uploaded. The supplied GitHub workflow needs **GitHub Actions** as the Pages source.
- Different desktop and headset settlements are expected: saves are browser-local. Transfer a JSON export; no synchronization service exists.

Keep your headset boundary and enough physical room to use the controllers. The app cannot replace the headset's physical-space protection.
