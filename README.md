# Aurelia

Build a small city beneath an alien sky, on a desktop or inside a Meta Quest 3 / 3S. This first version runs in a browser using Three.js and WebXR. There is no headset app to install.

You can place habitats, solar arrays, greenhouses, observatories, and landing pads; rotate or reclaim buildings; and save your settlement locally or export it as a file. This version is **single player**. Shared construction is a planned extension, with a separate world model and validated commands already in place.

## Try it on your Quest

The headset needs an **HTTPS address**. A desktop development address is not a headset deployment.

1. Commit and push this project, including its lockfile and workflow, to `vrmaria27/vrtest1` on `main`.
2. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source. GitHub Pages must be available for the repository and account.
3. Open **Actions → Deploy Aurelia → Run workflow** and select `main`.
4. When deployment finishes, open the URL reported by the deployment in the **Meta Quest Browser** on your headset. For the default GitHub Pages configuration, this is `https://vrmaria27.github.io/vrtest1/`.
5. Connect both controllers, choose **Enter VR**, and allow the browser's immersive-session prompt.

The workflow runs only when requested; adding it does not publish the app. No deployment has been performed by these instructions.

For an existing static host, download `artifacts/aurelia-site.zip`, extract it, and upload its app files to an **HTTPS** site. The archive has `index.html` at its root beside `assets/`. Or run `npm run build` and upload the contents of `dist/`. No backend or private key is needed for the current game. The local desktop preview is not a public headset URL.

See [Quest setup and controls](docs/QUEST.md) for the controller guide and troubleshooting. Automated tests exercise controller input with mocked WebXR sources. Physical headset behavior still needs testing on a Quest; those tests cannot establish tracking, comfort, or headset performance.

## Develop and test

Use Node.js 22 or later and npm. Each cloud task has its own isolated workspace; use the existing checkout rather than creating another Git worktree.

```sh
cd /workspace/vrtest1
npm ci
npm run dev
```

Use the development server on your computer for the desktop experience. It is not an HTTPS headset endpoint.

```sh
npm test          # World rules and persistence
npm run build    # Type checking and production build
npm run test:e2e # Browser interaction checks
```

For browser tests, install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable. The cloud environment can use `/usr/bin/chromium`. `npm run preview` serves the production output for local checking after a build.

## Your settlement

The economy starts with 24,000 credits. The starter outpost uses 1,040, leaving 22,960 credits for your city. Reclaiming a building returns 75% of its cost. Saves belong to the current browser and site address: the desktop and Quest do not share them automatically. Use **Export** and **Import** to move a settlement between them. Clearing browser data can erase a local save; keep an exported backup.

The first release is a creative construction prototype. Buildings do not yet simulate production or population, and there are no shared rooms, accounts, or network services. [Architecture and multiplayer path](docs/ARCHITECTURE.md) explains what is reusable and what still needs implementation.
