# Agent Games - Natural-Language Gaussian Splat Game Studio

Create browser games from a natural-language prompt and a Gaussian splat scene.

`agent-games` is an Astrocade-inspired prototype. The first workflow turns a
Gaussian splat scan into a PlayCanvas FPS generation surface: stream the splat,
prepare collision, plan Recast navigation, add gameplay/NPC steps, and publish a
shareable browser build.

## Trigger

Use this project when you want to:

- Prototype an AI game-generation platform
- Let users describe a game in natural language
- Upload or reuse a Gaussian splat scene as the game world
- Test a PlayCanvas Gaussian splat FPS workflow
- Track generation stages such as SOG streaming, collision, navmesh, NPCs, and publishing

## How It Works

The app is a Vite + TypeScript single-page prototype. It stores projects in
`localStorage`, renders an Astrocade-style lobby, and provides a Create Studio
where a user can describe a game and generate a PlayCanvas preview.

The built-in test scene lives at:

```text
data/23ebe85c/23ebe85c.ply
```

If the user does not upload a model, the Create flow uses that built-in PLY. The
local asset script converts it into PlayCanvas-readable streamed assets and
collision outputs.

## Current Features

- Astrocade-style Home and Create views
- Natural-language game prompt form
- Gaussian model upload surface for `.ply`, `.sog`, `.spz`, and `.ksplat`
- Built-in test PLY fallback
- PlayCanvas preview area with drag and wheel interaction
- Streamed SOG preview package loading through PlayCanvas `gsplat`
- Generation status rail for prompt, SOG, collision, navmesh, gameplay, NPCs, and publish
- Local generation audit showing which assets are ready and which are pending
- Local project persistence, generated versions, publish state, and share-link mock

## Gaussian Splat Pipeline

The intended generation pipeline follows the PlayCanvas Gaussian splat workflow:

```bash
splat-transform scene.ply \
  --seed-pos 0,1,0 \
  --voxel-params 0.05,0.1 \
  --voxel-carve 1.6,0.2 \
  -K \
  scene.sog
```

The command produces:

- `scene.sog` - streamed Gaussian scene bundle
- `scene.collision.glb` - collision mesh for static rigid bodies
- voxel data sidecars used during collision generation

The next intended step is:

```bash
recast scene.collision.glb navmesh.bin
```

`navmesh.bin` will be used by generated NPCs for pathfinding.

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

This script uses `@playcanvas/splat-transform` via `npx` and writes ignored
local artifacts next to `data/23ebe85c/23ebe85c.ply`.

Expected local outputs include:

- `data/23ebe85c/23ebe85c.sog`
- `data/23ebe85c/23ebe85c.collision.glb`
- `data/23ebe85c/23ebe85c.voxel.json`
- `data/23ebe85c/preview/meta.json`
- `data/23ebe85c/preview/*.webp`

### 4. Typecheck

```bash
npm run typecheck
```

### 5. Build

```bash
npm run build
```

### 6. Preview Production Build

```bash
npm run preview
```

## Quick Start Workflow

```bash
# Install dependencies
npm install

# Build local splat artifacts for the built-in test scene
npm run build:splat-assets

# Start the Create Studio
npm run dev -- --host 0.0.0.0 --port 5176

# Verify the code
npm run typecheck
npm run build
```

Then open:

```text
http://localhost:5176/#create
```

Click `Generate game`. If no model is uploaded, the app uses the built-in
`23ebe85c.ply` test scene and loads its streamed preview package.

## Implementation Status

Ready:

- Vite + TypeScript app shell
- Create Studio UI
- Built-in PLY test scene support
- Streamed SOG preview package for the built-in scene
- Collision GLB generated with `splat-transform`
- PlayCanvas preview mounting and mouse interaction

Pending:

- Real server-side generation pipeline for user uploads
- Recast `navmesh.bin` generation
- Real FPS player controller
- Real NPC character assets and behavior trees
- Collision GLB attachment as PlayCanvas rigid bodies
- Publish pipeline that emits a deployable game URL

## Submodules

This project includes:

- `modules/supersplat_ply_download` - [guwinston/supersplat_ply_download](https://github.com/guwinston/supersplat_ply_download)

Fetch submodules after cloning:

```bash
git submodule update --init --recursive
```

## Acknowledgements

Thanks to `guwinston/supersplat_ply_download` for providing a practical reference
for downloading public SuperSplat scene payloads and converting them to `PLY`.
It is useful for the `agent-games` Gaussian splat ingestion workflow,
especially when users start from public SuperSplat scene URLs.

The upstream project is a non-official tool and notes that scene content, model
data, and copyright remain with the original author or publisher. Use downloaded
or converted assets only when you have the right to access and use them.

Related upstream projects:

- SuperSplat: [https://superspl.at/](https://superspl.at/)
- PlayCanvas Engine: [https://github.com/playcanvas/engine](https://github.com/playcanvas/engine)
- PlayCanvas `splat-transform`: [https://github.com/playcanvas/splat-transform](https://github.com/playcanvas/splat-transform)
- Recast Navigation: [https://github.com/recastnavigation/recastnavigation](https://github.com/recastnavigation/recastnavigation)

## Notes

- `data/` is intentionally ignored because splat assets and generated artifacts can be large.
- `output/` and `.playwright-cli/` are ignored verification artifacts.
- Built-in local artifacts are generated from `data/23ebe85c/23ebe85c.ply`.
- The current publish URL is a mock until a real deployment pipeline is added.
- The current NPC/navmesh steps are represented in the UI but not fully implemented.
