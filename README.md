# Agent Games - AI Gaussian Splat Game Studio

Build browser games from a natural-language prompt and a Gaussian splat scene.

`agent-games` is an Astrocade-inspired prototype for generating PlayCanvas FPS
game projects. A user can describe a game, upload or reuse a `.ply` Gaussian
splat, watch the generator create the 3D preview, and publish a local playable
build card back to the Home gallery.

## Trigger

Use this project when you want to:

- Prototype an AI game-generation platform
- Turn natural language into a browser game project
- Use a Gaussian splat scene as the game world
- Convert splats into streamed SOG assets for PlayCanvas
- Generate collision GLB and Recast `navmesh.bin` outputs
- Keep every project run and intermediate artifact in a workspace folder
- Publish generated versions back into the Home gallery

## How It Works

The app is a Vite + TypeScript single-page studio with a local Vite middleware
API. The browser handles the lobby, Create flow, PlayCanvas preview, upload UI,
generation status, and publishing controls. The local server middleware owns
workspace folders, splat conversion, Recast navmesh export, generated plans, and
published HTML files.

The built-in test scene lives at:

```text
data/96fe38b6/96fe38b6.ply
```

If the user clicks `Generate game` without uploading a model, the project copies
that built-in PLY into the current project workspace and uses the precomputed
SOG, voxel JSON, and collision GLB from `data/96fe38b6` when available. It then creates a
Recast `navmesh.bin` for the generated run.

## Workflow

Each generation run follows the PlayCanvas Gaussian splat pipeline:

1. Read the prompt and create a project run.
2. Copy the uploaded or built-in PLY into `workspace/<projectId>/source`.
3. Convert the source splat into a streamed SOG bundle.
4. Generate voxel and collision outputs with `splat-transform`.
5. Build `navmesh.bin` with `recast-navigation`.
6. Ask the Pi agent layer for a game plan when an LLM provider key is available.
7. Write the generated plan, snapshot, local playable HTML, and manifest.
8. Publish the latest version into `workspace/<projectId>/published`.

Reference `splat-transform` command:

```bash
splat-transform scene.ply \
  --seed-pos 0,1,0 \
  --voxel-params 0.05,0.1 \
  --voxel-carve 1.6,0.2 \
  -K \
  scene.sog
```

The command emits a streamed SOG bundle plus collision outputs such as:

- `scene.sog`
- `scene.collision.glb`
- voxel sidecars used by the collision pass

## Workspace Layout

Generated projects are written to ignored local folders:

```text
workspace/
  <projectId>/
    manifest.json
    source/
      <uploaded-or-built-in>.ply
    runs/
      <runId>/
        source/
          <source>.ply
        scene.sog
        scene.voxel.json
        scene.collision.glb
        navmesh.bin
        gameplay-runtime.json
        behavior-tree.json
        generation-plan.json
        snapshot.svg
        publish/
          index.html
    published/
      index.html
```

`workspace/` is intentionally ignored except for `workspace/.gitignore`.

## AI Planning

The local generation middleware integrates the Pi coding-agent package:

```text
@earendil-works/pi-coding-agent
```

When a supported provider key is present, the server calls Pi in JSON mode to
turn the prompt into a structured game plan:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`

If no key is configured, the app uses a deterministic local fallback plan so the
pipeline can still create SOG, collision, navmesh, snapshot, and publish outputs.

## Available Commands

All commands are run from the project root:

```bash
cd agent-games
```

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Dev Server

```bash
npm run dev -- --host 0.0.0.0 --port 5176
```

Open:

```text
http://localhost:5176/#create
```

### 3. Build Built-In Splat Assets

```bash
npm run build:splat-assets
```

This uses `@playcanvas/splat-transform` through `npx` and writes ignored local
artifacts next to `data/96fe38b6/96fe38b6.ply`.

Expected local outputs include:

- `data/96fe38b6/96fe38b6.sog`
- `data/96fe38b6/96fe38b6.collision.glb`
- `data/96fe38b6/96fe38b6.voxel.json`
- `data/96fe38b6/preview/meta.json`
- `data/96fe38b6/preview/*.webp`

### 4. Verify

```bash
npm run typecheck
npm run build
```

### 5. Preview Production Build

```bash
npm run preview
```

## Quick Start Workflow

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5176
```

Then open:

```text
http://localhost:5176/#create
```

Click `Generate game`. If no model is uploaded, the Create flow uses the built-in
`96fe38b6.ply` test scene. The 3D preview appears first, then the generation
process resolves SOG, collision, navmesh, gameplay plan, NPC plan, and local
publish artifacts.

## Current Features

- Astrocade-style Home and Create views
- Sky-blue visual theme and responsive layout
- Natural-language prompt form
- Upload support for `.ply`, `.sog`, `.spz`, and `.ksplat`
- Built-in PLY fallback from `data/96fe38b6`
- PlayCanvas Gaussian splat preview with mouse drag and wheel interaction
- Local project API for ensure, upload, generate, publish, and asset serving
- Per-project workspace folders with source and run artifacts
- Streamed SOG output for generated runs
- Collision GLB output from the splat pipeline
- Recast `navmesh.bin` generation
- Pi agent planning integration with provider-key fallback
- PlayCanvas runtime scaffold with player movement, objective HUD, NPC patrol/chase states, and tagging
- Generated snapshot card for Home
- Local publish output under `workspace/<projectId>/published`

## Implementation Status

Ready:

- Create Studio UI and Home gallery
- Built-in test PLY flow
- Uploaded file storage in project workspaces
- SOG, voxel, collision, and navmesh run artifacts
- Generated plans, snapshots, manifests, and published HTML
- Gameplay runtime specs and behavior-tree JSON for player/NPC preview state
- PlayCanvas preview loading the generated SOG

Partially ready:

- NPCs are spawned as PlayCanvas runtime markers with patrol/chase/tagged states
- FPS gameplay is playable as an embedded preview scaffold with WASD movement, mouse look, tagging, ammo, and objective HUD
- Collision GLB is produced and tracked, but not yet attached as a live rigid body
- Recast navmesh uses a lightweight proxy when the full collision mesh is too large for the WASM generator

Pending:

- Production-quality character meshes, animation clips, weapons, pickups, and win-state presentation
- Full physics-backed collision response inside the PlayCanvas runtime
- Runtime navmesh debug visualization and NPC path queries
- Deployment to an external hosting target

## Submodules

This project includes:

- `modules/supersplat_ply_download` - [guwinston/supersplat_ply_download](https://github.com/guwinston/supersplat_ply_download)

Fetch submodules after cloning:

```bash
git submodule update --init --recursive
```

## Acknowledgements

Thanks to `guwinston/supersplat_ply_download` for providing a practical
reference for downloading public SuperSplat scene payloads and converting them
to `PLY`. It is useful for the `agent-games` Gaussian splat ingestion workflow,
especially when users start from public SuperSplat scene URLs.

The upstream project is a non-official tool and notes that scene content, model
data, and copyright remain with the original author or publisher. Use downloaded
or converted assets only when you have the right to access and use them.

Related upstream projects:

- SuperSplat: [https://superspl.at/](https://superspl.at/)
- PlayCanvas Engine: [https://github.com/playcanvas/engine](https://github.com/playcanvas/engine)
- PlayCanvas `splat-transform`: [https://github.com/playcanvas/splat-transform](https://github.com/playcanvas/splat-transform)
- Recast Navigation JS: [https://github.com/isaac-mason/recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)
- Pi: [https://pi.dev/docs/latest](https://pi.dev/docs/latest)

## Notes

- `data/` is intentionally ignored because splat assets can be very large.
- `workspace/` is intentionally ignored because generated projects and runs are local artifacts.
- `output/` and `.playwright-cli/` are ignored verification artifacts.
- The dev server used during local testing runs on `http://localhost:5176`.
