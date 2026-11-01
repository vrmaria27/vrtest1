# Architecture and the multiplayer path

## Current implementation

The application is a static TypeScript frontend bundled with Vite. Three.js owns rendering and its WebXR integration submits the stereo view. The environment and buildings are procedural, so startup does not depend on external model or texture services.

The important boundaries are:

- `src/domain/world.ts`: renderer-independent world schema, catalog, grid rules, resource accounting, and deterministic `place` / `remove` commands.
- `src/persistence.ts`: a storage adapter around the versioned save format. The first implementation stores one local settlement.
- `src/scene/planet.ts`: planet scenery and building visuals.
- `src/xr.ts`: tracked-controller input, teleportation, snap turning, and the headset HUD.
- `src/main.ts`: browser interface, application state, placement interaction, and integration.

Positions are integer grid cells, with five meters per cell. Building IDs are stable strings, rotations are quarter turns, and accepted edits advance a revision. A place command supplies its building ID rather than generating one inside the rules. This makes the command result reproducible. Optional `expectedRevision` rejects an edit against stale state.

Imports are untrusted input. The validator checks schema/version, field names, identifier and coordinate bounds, occupancy, resource limits, and save-size limits before replacing the world. File contents are data, never executable code. The current renderer uses the fixed Aurelia planet; the saved seed is reserved for future compatible world generation, not a promise that changing it changes the terrain today.

## Persistence and compatibility

The save format has an explicit `version`. Keep exported version-1 files usable when the app evolves: add a tested migration before introducing a new version, migrate into a validated current model, and retain the original export if migration fails. Never silently reinterpret units or building types. Browser storage is a convenience, not durable cloud storage; it can be unavailable, full, or cleared.

The local undo history is an interaction feature, not a distributed command log. Future multiplayer undo must be represented as a validated compensating command; replacing a whole older snapshot would discard other people's edits.

## Adding shared construction

There is **no multiplayer connection, authentication, server, or shared persistence in this release**. The command boundary reduces the amount of game-rule rewriting needed later, but it is not a multiplayer implementation or a security boundary by itself.

A practical next increment is an authoritative room service:

1. Give each shared world its own server identity and persist its versioned snapshot plus accepted command sequence in a durable database.
2. Authenticate participants and enforce per-world owner/editor/viewer permissions. Never trust a client's claimed credits, world snapshot, or role.
3. Accept a command envelope containing a unique operation ID, world ID, actor identity derived from authentication, and expected revision. Validate the command using the shared domain rules on the server.
4. Serialize edits per world, deduplicate retried operation IDs, commit accepted edits atomically, and broadcast the new revision over WebSocket. Return a clear conflict when a site or revision has changed.
5. On reconnect, fetch missing revisions or a validated snapshot before enabling edits. Define the offline policy explicitly; the simplest first shared version disables offline edits rather than silently losing changes.
6. Send presence separately from durable city edits. Interpolate avatar poses and limit their update rate; avoid persisting every headset movement.

Test simultaneous placement on one cell, duplicate/replayed operations, permission failures, reconnect gaps, version mismatches, and interrupted database writes. Add TLS, origin validation, message limits, rate limiting, and operational backups with the service. Keep remote transport behind an interface so single-player local worlds can continue to work.

## Performance and validation

The first scene uses modest procedural geometry, no downloadable art, and no costly postprocessing. That is a starting point for Quest, not a frame-rate guarantee. Profile on the headset with realistic larger settlements before increasing detail; batching or instancing repeated buildings is a likely later improvement.

Domain tests establish placement and persistence rules. Browser tests can establish desktop loading, editing, and save behavior. Controller tests use mocked WebXR input sources to exercise input handling. These checks do not verify physical headset tracking, actual controller mapping, motion comfort, or sustained headset frame rate. Record those separately after a real Quest session.
