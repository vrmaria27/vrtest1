# Quest setup and controls

## Open your world

Use the current Meta Quest Browser on a Quest 3 / 3S, with two tracked controllers. Open the app's deployed **HTTPS** URL in a normal browser tab. Wait for the world to load, then select **Enter VR** and accept the browser prompt. Headset use requires an immersive WebXR-capable browser; a desktop browser may offer the desktop view only.

WebXR requires a secure context. An ordinary `http://` address on your computer's network does not meet that requirement on the headset. A self-signed certificate also needs to be trusted by the headset; the quickest route for this project is a real HTTPS static deployment using the [README instructions](../README.md#try-it-on-your-quest).

## In VR

| Input | Action |
| --- | --- |
| Point the right controller | Preview a building site on the grid |
| Right trigger | Place the selected building, or reclaim it in reclaim mode |
| A | Next building type |
| X | Previous building type |
| B | Switch between build and reclaim modes |
| Y | Rotate the preview a quarter turn |
| Push the left thumbstick, aim the left controller, then release | Teleport to the indicated ground point |
| Right thumbstick left / right | Turn in 30° steps |

The headset HUD shows the selected building, remaining credits, current mode, and placement feedback. The marked arrival area stays clear of buildings. Teleportation and snap turning are used instead of continuous camera movement. Use your headset's normal system controls to leave immersive mode.

Hand tracking is not part of this release. Controller input has automated coverage using mocked WebXR sources. Actual controller mapping, visual scale, comfort, and frame rate still require a physical headset check before calling the VR experience verified.

## On a desktop

| Input | Action |
| --- | --- |
| Click an empty grid site | Place a building |
| Drag | Orbit the view |
| Scroll | Zoom |
| 1–5 | Select a building type |
| R | Rotate the preview |
| D | Reclaim mode |
| B | Build mode |
| Ctrl / Cmd + Z | Undo the last edit |

Use the visible controls to change buildings, save backups, import worlds, and reset your view. Import replaces the active settlement after validation; export a backup first if you want to retain both.

## If VR does not start

- Confirm you are on the deployed `https://` address in **Meta Quest Browser**. An embedded browser inside another app may not support immersive WebXR.
- Update the headset/browser, connect both controllers, and try entering VR again from a normal tab. Browser permission denial must be resolved before another session can start.
- If the browser still reports no VR support, the desktop builder remains available. Record the headset/browser version and the displayed error for diagnosis.
- If the world is missing, confirm the deployment completed and that the entire `dist/` output was uploaded. GitHub Pages must use the **GitHub Actions** source for the provided workflow.
- If desktop and headset settlements differ, they are separate browser saves. Transfer an exported world file; there is no synchronization service yet.

Keep your headset's boundary and enough physical room to use the controllers. The app cannot replace the headset's physical-space protection.
