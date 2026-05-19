# agent-games

AI game generation platform prototype inspired by Astrocade-style natural-language creation.

The first entry point is a Gaussian splat FPS workflow:

- Users upload a `.ply`, `.sog`, `.spz`, or `.ksplat` scene model
- Users describe the game in natural language
- The app generates a playable-game blueprint with pipeline stages, mechanics, versions, and a publishable link
- The FPS template is based on streamed splats, collision GLB, Recast navmesh, NPCs, and browser publishing

## Current implementation

- Vite + TypeScript single-page app
- Local project persistence through `localStorage`
- Conversation-driven generation UI
- Upload surface for Gaussian model assets
- Project list, generated versions, publish status, and preview canvas
- PlayCanvas-powered 3D FPS template preview, loaded as a separate runtime chunk

## Planned implementation seams

- Replace mocked generation with an LLM-backed game-spec generator
- Run `splat-transform` server-side or in a worker pipeline
- Store uploaded assets and generated build artifacts
- Mount PlayCanvas in the preview canvas
- Add Recast navmesh generation and NPC runtime behavior

## Submodules and acknowledgements

This project includes the following Git submodule:

- `modules/supersplat_ply_download` -> [guwinston/supersplat_ply_download](https://github.com/guwinston/supersplat_ply_download)

Thanks to the `supersplat_ply_download` project for providing a practical reference for downloading public SuperSplat scene payloads and converting them to `PLY`. It is useful for the `agent-games` Gaussian splat ingestion workflow, especially when users start from public SuperSplat scene URLs.

The upstream project is a non-official tool and notes that scene content, model data, and copyright remain with the original author or publisher. Use downloaded or converted assets only when you have the right to access and use them.

Related upstream projects referenced by that module include:

- SuperSplat: [https://superspl.at/](https://superspl.at/)
- PlayCanvas `@playcanvas/splat-transform`: [https://github.com/playcanvas/splat-transform](https://github.com/playcanvas/splat-transform)
- PlayCanvas Engine: [https://github.com/playcanvas/engine](https://github.com/playcanvas/engine)

To fetch submodules after cloning `agent-games`:

```bash
git submodule update --init --recursive
```

## Scripts

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run typecheck`
