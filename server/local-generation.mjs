import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { exportNavMesh, init as initRecast } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(root, 'workspace');
const builtInSceneRoot = join(root, 'data', '96fe38b6');
const builtInSource = join(builtInSceneRoot, '96fe38b6.ply');
const humanoidAssetUrl = '/assets/characters/CesiumMan.glb';
const fallbackHumanoidAssetUrl = '/assets/characters/RiggedFigure.glb';
const largeSplatThresholdBytes = 350 * 1024 * 1024;
const piSystemPrompt = [
  'You design browser FPS games built from Gaussian splat scenes.',
  'Return strict JSON with keys:',
  'title, summary, mechanics, npcArchetypes, objective, publishTag, snapshotCaption, characterStyle, weaponStyle, combat.',
  'The mechanics value must be an array of short strings.',
  'The npcArchetypes value must be an array of objects with name, role, and behavior.',
].join(' ');

let recastReady;

export function createLocalGenerationPlugin() {
  return {
    name: 'agent-games-local-generation',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const requestUrl = new URL(req.url, 'http://localhost');
        const { pathname } = requestUrl;

        if (pathname.startsWith('/api/')) {
          await handleApiRequest(req, res, pathname).catch((error) => {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : 'Generation request failed.',
            });
          });
          return;
        }

        if (pathname.startsWith('/workspace/')) {
          await serveWorkspaceAsset(req, res, pathname).catch((error) => {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : 'Failed to serve workspace asset.',
            });
          });
          return;
        }

        next();
      });
    },
  };
}

async function handleApiRequest(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/projects') {
    const projects = await listWorkspaceProjects();
    sendJson(res, 200, { projects });
    return;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(?:\/([^/]+))?$/);
  if (!projectMatch) {
    sendJson(res, 404, { error: 'Unknown API route.' });
    return;
  }

  const projectId = decodeURIComponent(projectMatch[1]);
  const action = projectMatch[2];

  if (req.method === 'GET' && !action) {
    const manifest = await readProjectManifest(projectId);
    sendJson(res, 200, { project: manifest });
    return;
  }

  if (req.method === 'POST' && action === 'ensure') {
    const payload = await readJsonBody(req);
    const manifest = await ensureProjectManifest(projectId, payload ?? {});
    sendJson(res, 200, { project: manifest });
    return;
  }

  if (req.method === 'POST' && action === 'upload') {
    const filename = getUploadName(req);
    const body = await readRawBody(req);
    const manifest = await storeProjectUpload(projectId, filename, body);
    sendJson(res, 200, { project: manifest });
    return;
  }

  if (req.method === 'POST' && action === 'generate') {
    const payload = await readJsonBody(req);
    const result = await generateWorkspaceBuild(projectId, payload ?? {});
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && action === 'publish') {
    const payload = await readJsonBody(req);
    const result = await publishWorkspaceBuild(projectId, payload ?? {});
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: 'Unknown project action.' });
}

async function listWorkspaceProjects() {
  await ensureDir(workspaceRoot);
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifest = await readProjectManifest(entry.name).catch(() => null);
    if (manifest) {
      projects.push(manifest);
    }
  }

  projects.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return projects;
}

async function readProjectManifest(projectId) {
  const manifestPath = getProjectManifestPath(projectId);
  if (!existsSync(manifestPath)) {
    return ensureProjectManifest(projectId);
  }

  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  return normalizeManifest(projectId, manifest);
}

async function ensureProjectManifest(projectId, seed = {}) {
  await ensureProjectFolder(projectId);
  const manifestPath = getProjectManifestPath(projectId);
  const existing = existsSync(manifestPath)
    ? normalizeManifest(projectId, JSON.parse(await fs.readFile(manifestPath, 'utf8')))
    : null;
  const now = nowIso();
  const manifest = {
    id: projectId,
    name: seed.name ?? existing?.name ?? `Splat Game ${projectId.slice(0, 4)}`,
    prompt: seed.prompt ?? existing?.prompt ?? '',
    modelName: seed.modelName ?? existing?.modelName ?? '',
    modelSource: seed.modelSource ?? existing?.modelSource ?? 'builtin',
    modelUrl: seed.modelUrl ?? existing?.modelUrl ?? '',
    status: seed.status ?? existing?.status ?? 'draft',
    createdAt: existing?.createdAt ?? seed.createdAt ?? now,
    updatedAt: now,
    source: seed.source ?? existing?.source ?? null,
    runs: Array.isArray(existing?.runs) ? existing.runs : [],
  };

  await writeJson(manifestPath, manifest);
  return normalizeManifest(projectId, manifest);
}

async function storeProjectUpload(projectId, fileName, body) {
  const manifest = await ensureProjectManifest(projectId);
  const uploadName = sanitizeFileName(fileName || `${projectId}.ply`);
  const uploadDir = join(getProjectDir(projectId), 'source');
  await ensureDir(uploadDir);
  const uploadPath = join(uploadDir, uploadName);
  await fs.writeFile(uploadPath, body);
  const nextManifest = {
    ...manifest,
    modelName: uploadName,
    modelSource: 'uploaded',
    modelUrl: workspaceUrl(projectId, ['source', uploadName]),
    source: {
      fileName: uploadName,
      path: uploadPath,
      url: workspaceUrl(projectId, ['source', uploadName]),
      kind: 'uploaded',
      size: body.byteLength,
    },
    updatedAt: nowIso(),
  };
  await writeProjectManifest(projectId, nextManifest);
  return normalizeManifest(projectId, nextManifest);
}

async function generateWorkspaceBuild(projectId, payload) {
  const manifest = await ensureProjectManifest(projectId, payload);
  const prompt = String(payload.prompt ?? manifest.prompt ?? '').trim();
  const sourceRecord = await ensureSourceForProject(projectId, manifest);
  const runId = createRunId();
  const runDir = join(getProjectDir(projectId), 'runs', runId);
  const sourceDir = join(runDir, 'source');
  const previewDir = join(runDir, 'preview');
  const publishDir = join(runDir, 'publish');
  await Promise.all([ensureDir(runDir), ensureDir(sourceDir), ensureDir(previewDir), ensureDir(publishDir)]);

  const runSourceName = sourceRecord.fileName || `${projectId}.ply`;
  const runSourcePath = join(sourceDir, runSourceName);
  await fs.copyFile(sourceRecord.path, runSourcePath);

  const streamedPath = join(runDir, 'scene.sog');
  const previewMetaPath = join(previewDir, 'meta.json');
  const voxelPath = join(runDir, 'scene.voxel.json');
  const collisionPath = join(runDir, 'scene.collision.glb');
  const navmeshPath = join(runDir, 'navmesh.bin');
  const planPath = join(runDir, 'generation-plan.json');
  const runtimePath = join(runDir, 'gameplay-runtime.json');
  const behaviorTreePath = join(runDir, 'behavior-tree.json');
  const snapshotPath = join(runDir, 'snapshot.svg');
  const publishPath = join(publishDir, 'index.html');

  const useBuiltInAssets = sourceRecord.kind === 'builtin' && runSourceName === '96fe38b6.ply';
  const builtInArtifacts = [
    join(builtInSceneRoot, '96fe38b6.sog'),
    join(builtInSceneRoot, '96fe38b6.voxel.json'),
    join(builtInSceneRoot, '96fe38b6.collision.glb'),
  ];
  const hasBuiltInArtifacts = builtInArtifacts.every((assetPath) => existsSync(assetPath));
  const sceneAssets = await prepareSceneAssets({
    runSourcePath,
    streamedPath,
    previewMetaPath,
    voxelPath,
    collisionPath,
    navmeshPath,
    useBuiltInAssets,
    hasBuiltInArtifacts,
  });
  const sourceUrl = workspaceUrl(projectId, ['runs', runId, 'source', runSourceName]);
  const streamedUrl = sceneAssets.streamed ? workspaceUrl(projectId, ['runs', runId, 'scene.sog']) : sourceUrl;
  const collisionUrl = sceneAssets.collision ? workspaceUrl(projectId, ['runs', runId, 'scene.collision.glb']) : '';
  const navmeshUrl = sceneAssets.navmesh ? workspaceUrl(projectId, ['runs', runId, 'navmesh.bin']) : '';

  const plan = await getGamePlan({
    prompt,
    sourceName: runSourceName,
    projectName: manifest.name,
    runId,
  });
  const runtimeSpec = buildGameplayRuntime(plan, runId);
  const behaviorTree = buildBehaviorTree(plan, runtimeSpec);
  await writeJson(planPath, plan);
  await writeJson(runtimePath, runtimeSpec);
  await writeJson(behaviorTreePath, behaviorTree);
  await fs.writeFile(snapshotPath, createSnapshotSvg({
    title: plan.title,
    prompt,
    sourceName: runSourceName,
    summary: plan.summary,
    mechanics: plan.mechanics,
    npcArchetypes: plan.npcArchetypes,
    publishTag: plan.publishTag,
  }));
  await fs.writeFile(publishPath, createPublishedHtml({
    title: plan.title,
    summary: plan.summary,
    snapshotUrl: workspaceUrl(projectId, ['runs', runId, 'snapshot.svg']),
    publishUrl: workspaceUrl(projectId, ['runs', runId, 'publish', 'index.html']),
    sourceUrl,
    streamedUrl,
    collisionUrl,
    navmeshUrl,
    runtimeUrl: workspaceUrl(projectId, ['runs', runId, 'gameplay-runtime.json']),
    behaviorTreeUrl: workspaceUrl(projectId, ['runs', runId, 'behavior-tree.json']),
    objective: plan.objective,
    mechanics: plan.mechanics,
    npcArchetypes: plan.npcArchetypes,
  }));

  const version = {
    id: runId,
    title: plan.title,
    summary: plan.summary,
    mechanics: plan.mechanics,
    shareUrl: workspaceUrl(projectId, ['runs', runId, 'publish', 'index.html']),
    createdAt: nowIso(),
    sourceUrl,
    streamedUrl,
    collisionUrl,
    navmeshUrl,
    runtimeUrl: workspaceUrl(projectId, ['runs', runId, 'gameplay-runtime.json']),
    behaviorTreeUrl: workspaceUrl(projectId, ['runs', runId, 'behavior-tree.json']),
    snapshotUrl: workspaceUrl(projectId, ['runs', runId, 'snapshot.svg']),
    publishUrl: workspaceUrl(projectId, ['runs', runId, 'publish', 'index.html']),
    workspacePath: join('workspace', projectId, 'runs', runId),
    npcArchetypes: plan.npcArchetypes,
    objective: plan.objective,
    publishTag: plan.publishTag,
    assetStatus: sceneAssets,
  };

  const nextManifest = {
    ...manifest,
    name: plan.title,
    prompt,
    modelName: sourceRecord.fileName,
    modelSource: sourceRecord.kind,
    modelUrl: workspaceUrl(projectId, ['runs', runId, 'source', runSourceName]),
    status: 'generated',
    source: sourceRecord,
    updatedAt: nowIso(),
    latestRunId: runId,
    latestRunPath: join('workspace', projectId, 'runs', runId),
    runs: [version, ...(manifest.runs || [])],
  };
  await writeProjectManifest(projectId, nextManifest);

  return {
    project: normalizeManifest(projectId, nextManifest),
    version,
    plan,
  };
}

async function publishWorkspaceBuild(projectId, payload) {
  const manifest = await readProjectManifest(projectId);
  if (!manifest.runs?.length) {
    throw new Error('No generated version is available to publish yet.');
  }

  const latestVersion = manifest.runs[0];
  const publishDir = join(getProjectDir(projectId), 'published');
  await ensureDir(publishDir);
  const publishIndexPath = join(publishDir, 'index.html');
  await fs.writeFile(publishIndexPath, createPublishedHtml({
    title: latestVersion.title,
    summary: latestVersion.summary,
    snapshotUrl: latestVersion.snapshotUrl,
    publishUrl: workspaceUrl(projectId, ['published', 'index.html']),
    sourceUrl: latestVersion.sourceUrl,
    streamedUrl: latestVersion.streamedUrl,
    collisionUrl: latestVersion.collisionUrl,
    navmeshUrl: latestVersion.navmeshUrl,
    runtimeUrl: latestVersion.runtimeUrl,
    behaviorTreeUrl: latestVersion.behaviorTreeUrl,
    objective: latestVersion.objective,
    mechanics: latestVersion.mechanics || [],
    npcArchetypes: latestVersion.npcArchetypes || [],
    published: true,
  }));

  const nextManifest = {
    ...manifest,
    status: 'published',
    updatedAt: nowIso(),
    publishedUrl: workspaceUrl(projectId, ['published', 'index.html']),
    runs: [
      {
        ...latestVersion,
        shareUrl: workspaceUrl(projectId, ['published', 'index.html']),
        publishUrl: workspaceUrl(projectId, ['published', 'index.html']),
      },
      ...manifest.runs.slice(1),
    ],
  };
  await writeProjectManifest(projectId, nextManifest);

  return {
    project: normalizeManifest(projectId, nextManifest),
    version: nextManifest.runs[0],
  };
}

async function ensureSourceForProject(projectId, manifest) {
  await ensureProjectFolder(projectId);
  const sourceDir = join(getProjectDir(projectId), 'source');
  await ensureDir(sourceDir);

  if (manifest.source?.path && existsSync(manifest.source.path)) {
    return normalizeSource(projectId, manifest.source);
  }

  if (!existsSync(builtInSource)) {
    throw new Error(`Built-in test PLY not found: ${builtInSource}`);
  }

  const fileName = '96fe38b6.ply';
  const path = join(sourceDir, fileName);
  if (!existsSync(path)) {
    await fs.copyFile(builtInSource, path);
  }

  const source = normalizeSource(projectId, {
    fileName,
    path,
    url: workspaceUrl(projectId, ['source', fileName]),
    kind: 'builtin',
    size: (await fs.stat(path)).size,
  });

  await writeProjectManifest(projectId, {
    ...manifest,
    source,
    modelName: source.fileName,
    modelSource: 'builtin',
    modelUrl: source.url,
  });

  return source;
}

async function prepareSceneAssets({
  runSourcePath,
  streamedPath,
  previewMetaPath,
  voxelPath,
  collisionPath,
  navmeshPath,
  useBuiltInAssets,
  hasBuiltInArtifacts,
}) {
  const status = {
    streamed: false,
    collision: false,
    navmesh: false,
    mode: 'pending',
    warnings: [],
  };

  if (useBuiltInAssets && hasBuiltInArtifacts) {
    await fs.copyFile(join(builtInSceneRoot, '96fe38b6.sog'), streamedPath);
    await fs.copyFile(join(builtInSceneRoot, '96fe38b6.voxel.json'), voxelPath);
    await fs.copyFile(join(builtInSceneRoot, '96fe38b6.collision.glb'), collisionPath);
    await generateNavmesh(collisionPath, navmeshPath);
    return {
      ...status,
      streamed: true,
      collision: true,
      navmesh: true,
      mode: 'precomputed',
    };
  }

  const sourceSize = (await fs.stat(runSourcePath)).size;
  if (sourceSize > largeSplatThresholdBytes && process.env.AGENT_GAMES_FORCE_TRANSFORM !== '1') {
    await generateDefaultNavmesh(navmeshPath);
    return {
      ...status,
      navmesh: true,
      mode: 'source-preview',
      warnings: [
        'PLY is large and precomputed SOG/collision assets were not found; using source PLY preview and lightweight navmesh.',
      ],
    };
  }

  try {
    await runSplatTransform(runSourcePath, streamedPath, previewMetaPath, collisionPath);
    status.streamed = existsSync(streamedPath);
    status.collision = existsSync(collisionPath);
    if (status.collision) {
      await generateNavmesh(collisionPath, navmeshPath);
      status.navmesh = existsSync(navmeshPath);
    }
    status.mode = status.streamed && status.collision ? 'generated' : 'partial';
    if (!status.collision) {
      await generateDefaultNavmesh(navmeshPath);
      status.navmesh = true;
      status.warnings.push('splat-transform finished without scene.collision.glb; generated a lightweight navmesh fallback.');
    }
    return status;
  } catch (error) {
    await generateDefaultNavmesh(navmeshPath);
    return {
      ...status,
      streamed: existsSync(streamedPath),
      collision: existsSync(collisionPath),
      navmesh: existsSync(navmeshPath),
      mode: 'fallback',
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runSplatTransform(sourcePath, streamedPath, previewMetaPath, collisionPath) {
  const primary = await runCommand('npx', [
    '@playcanvas/splat-transform',
    '-w',
    sourcePath,
    '--seed-pos',
    '0,1,0',
    '--voxel-params',
    '0.05,0.1',
    '--voxel-carve',
    '1.6,0.2',
    '-K',
    streamedPath,
  ], getNodeOptionsEnv());

  if (primary.ok && existsSync(streamedPath) && existsSync(collisionPath)) {
    await runCommand('npx', [
      '@playcanvas/splat-transform',
      '-w',
      sourcePath,
      previewMetaPath,
    ], getNodeOptionsEnv());
    return;
  }

  const retry = await runCommand('npx', [
    '@playcanvas/splat-transform',
    '-w',
    sourcePath,
    '--seed-pos',
    '0,1,0',
    '--voxel-params',
    '0.12,0.12',
    '--voxel-carve',
    '2.4,0.3',
    '-K',
    streamedPath,
  ], {
    ...getNodeOptionsEnv(),
    NODE_OPTIONS: '--max-old-space-size=8192',
  });

  if (!retry.ok || !existsSync(streamedPath) || !existsSync(collisionPath)) {
    throw new Error('splat-transform failed to build the collision voxel output.');
  }

  await runCommand('npx', [
    '@playcanvas/splat-transform',
    '-w',
    sourcePath,
    previewMetaPath,
  ], getNodeOptionsEnv());
}

async function generateNavmesh(collisionPath, navmeshPath) {
  await ensureRecast();
  if (!existsSync(collisionPath)) {
    throw new Error(`Collision GLB not found: ${collisionPath}`);
  }

  const { positions, indices, bounds } = await extractGeometryFromGlb(collisionPath);
  if (!positions.length || !indices.length) {
    throw new Error('Collision GLB does not contain enough triangle data for navmesh generation.');
  }

  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  if (vertexCount > 120_000 || triangleCount > 240_000) {
    await generateBoundsProxyNavmesh(bounds, navmeshPath);
    return;
  }

  const presets = [
    {
      cs: 0.36,
      ch: 0.18,
      walkableSlopeAngle: 80,
      walkableHeight: 1.3,
      walkableClimb: 1.4,
      walkableRadius: 0.1,
      maxEdgeLen: 24,
      maxSimplificationError: 2.0,
      minRegionArea: 0,
      mergeRegionArea: 2,
      detailSampleDist: 0,
      detailSampleMaxError: 1,
    },
    {
      cs: 0.24,
      ch: 0.12,
      walkableSlopeAngle: 70,
      walkableHeight: 1.6,
      walkableClimb: 1.0,
      walkableRadius: 0.2,
      maxEdgeLen: 18,
      maxSimplificationError: 1.8,
      minRegionArea: 1,
      mergeRegionArea: 4,
      detailSampleDist: 2,
      detailSampleMaxError: 1,
    },
    {
      cs: 0.14,
      ch: 0.07,
      walkableSlopeAngle: 60,
      walkableHeight: 1.9,
      walkableClimb: 0.8,
      walkableRadius: 0.3,
      maxEdgeLen: 14,
      maxSimplificationError: 1.4,
      minRegionArea: 2,
      mergeRegionArea: 8,
      detailSampleDist: 4,
      detailSampleMaxError: 1,
    },
  ];

  let lastError = 'Navmesh generation failed.';
  for (const preset of presets) {
    let navMeshResult;
    try {
      navMeshResult = generateSoloNavMesh(positions, indices, {
        bounds: [bounds.min, bounds.max],
        buildBvTree: true,
        maxVertsPerPoly: 6,
        ...preset,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      continue;
    }

    if (navMeshResult.success) {
      await fs.writeFile(navmeshPath, exportNavMesh(navMeshResult.navMesh));
      return;
    }

    lastError = navMeshResult.error || lastError;
  }

  await generateBoundsProxyNavmesh(bounds, navmeshPath, lastError);
}

async function generateDefaultNavmesh(navmeshPath) {
  await generateBoundsProxyNavmesh({
    min: [-10, 0, -10],
    max: [10, 3.2, 10],
  }, navmeshPath);
}

async function generateBoundsProxyNavmesh(bounds, navmeshPath, upstreamError = '') {
  await ensureRecast();
  const proxy = createBoundsNavmeshProxy(bounds);
  let proxyResult;
  try {
    proxyResult = generateSoloNavMesh(proxy.positions, proxy.indices, {
      bounds: [proxy.bounds.min, proxy.bounds.max],
      buildBvTree: true,
      maxVertsPerPoly: 6,
      cs: 0.3,
      ch: 0.2,
      walkableSlopeAngle: 45,
      walkableHeight: 2,
      walkableClimb: 1,
      walkableRadius: 1,
      maxEdgeLen: 12,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${upstreamError || 'Navmesh generation failed.'}; fallback proxy crashed: ${message}`);
  }

  if (!proxyResult.success) {
    throw new Error(`${upstreamError || 'Navmesh generation failed.'}; fallback proxy failed: ${proxyResult.error}`);
  }

  await fs.writeFile(navmeshPath, exportNavMesh(proxyResult.navMesh));
}

function createBoundsNavmeshProxy(bounds) {
  const width = bounds.max[0] - bounds.min[0];
  const depth = bounds.max[2] - bounds.min[2];
  const insetX = Math.max(1, width * 0.12);
  const insetZ = Math.max(1, depth * 0.12);
  const minX = bounds.min[0] + insetX;
  const maxX = bounds.max[0] - insetX;
  const minZ = bounds.min[2] + insetZ;
  const maxZ = bounds.max[2] - insetZ;
  const y = bounds.min[1] + Math.max(0.2, (bounds.max[1] - bounds.min[1]) * 0.04);
  const segments = 10;
  const positions = [];
  const indices = [];
  const vertexIndex = (x, z) => z * (segments + 1) + x;

  for (let z = 0; z <= segments; z += 1) {
    const zRatio = z / segments;
    for (let x = 0; x <= segments; x += 1) {
      const xRatio = x / segments;
      positions.push(
        minX + (maxX - minX) * xRatio,
        y,
        minZ + (maxZ - minZ) * zRatio,
      );
    }
  }

  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      indices.push(
        vertexIndex(x, z),
        vertexIndex(x + 1, z + 1),
        vertexIndex(x + 1, z),
        vertexIndex(x, z),
        vertexIndex(x, z + 1),
        vertexIndex(x + 1, z + 1),
      );
    }
  }

  return {
    positions,
    indices,
    bounds: {
      min: [minX, y - 1, minZ],
      max: [maxX, y + 2, maxZ],
    },
  };
}

async function extractGeometryFromGlb(glbPath) {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const positions = [];
  const indices = [];
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  const matrixTarget = new Float32Array(16);
  const vertexTarget = [0, 0, 0];
  const worldTarget = [0, 0, 0];

  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) {
      child.traverse((node) => {
        const mesh = node.getMesh();
        if (!mesh) {
          return;
        }

        const matrix = node.getWorldMatrix();
        for (const primitive of mesh.listPrimitives()) {
          if (primitive.getMode() !== 4) {
            continue;
          }

          const positionAccessor = primitive.getAttribute('POSITION');
          if (!positionAccessor) {
            continue;
          }

          const baseVertex = positions.length / 3;
          for (let index = 0; index < positionAccessor.getCount(); index += 1) {
            positionAccessor.getElement(index, vertexTarget);
            transformPoint(matrix, vertexTarget, worldTarget);
            positions.push(worldTarget[0], worldTarget[1], worldTarget[2]);
            expandBounds(bounds, worldTarget);
          }

          const indexAccessor = primitive.getIndices();
          if (indexAccessor) {
            for (let index = 0; index < indexAccessor.getCount(); index += 1) {
              indices.push(indexAccessor.getScalar(index) + baseVertex);
            }
          } else {
            for (let vertex = 0; vertex < positionAccessor.getCount(); vertex += 3) {
              indices.push(baseVertex + vertex, baseVertex + vertex + 1, baseVertex + vertex + 2);
            }
          }
        }
      });
    }
  }

  if (!Number.isFinite(bounds.min[0])) {
    bounds.min = [-1, -1, -1];
    bounds.max = [1, 1, 1];
  }

  matrixTarget.fill(0);
  return { positions, indices, bounds };
}

async function getGamePlan({ prompt, sourceName, projectName, runId }) {
  const fallback = buildFallbackPlan(prompt, sourceName, projectName, runId);
  const provider = pickPiProvider();
  if (!provider) {
    return fallback;
  }

  const args = [
    '-p',
    '--mode',
    'json',
    '--provider',
    provider.provider,
    '--model',
    provider.model,
    '--system-prompt',
    piSystemPrompt,
    `${prompt}\n\nSource asset: ${sourceName}\nProject: ${projectName}\nRespond with strict JSON only.`,
  ];

  const result = await runCommand('npx', ['@earendil-works/pi-coding-agent', ...args], {
    ...process.env,
    PI_OFFLINE: process.env.PI_OFFLINE ?? '0',
  });

  if (!result.ok || !result.stdout.trim()) {
    return fallback;
  }

  const parsed = parseLikelyJson(result.stdout);
  if (!parsed) {
    return fallback;
  }

  return {
    title: String(parsed.title || fallback.title),
    summary: String(parsed.summary || fallback.summary),
    mechanics: Array.isArray(parsed.mechanics) ? parsed.mechanics.map((item) => String(item)).slice(0, 8) : fallback.mechanics,
    npcArchetypes: expandNpcArchetypes(Array.isArray(parsed.npcArchetypes) ? parsed.npcArchetypes : fallback.npcArchetypes),
    objective: String(parsed.objective || fallback.objective),
    publishTag: String(parsed.publishTag || fallback.publishTag),
    snapshotCaption: String(parsed.snapshotCaption || fallback.snapshotCaption),
    characterStyle: String(parsed.characterStyle || fallback.characterStyle || 'open-source humanoid rigs'),
    weaponStyle: String(parsed.weaponStyle || fallback.weaponStyle || 'procedural first-person rifle viewmodel'),
    combat: {
      fireRate: Number(parsed.combat?.fireRate || fallback.combat.fireRate),
      magazineSize: Number(parsed.combat?.magazineSize || fallback.combat.magazineSize),
      reloadTime: Number(parsed.combat?.reloadTime || fallback.combat.reloadTime),
      recoil: Number(parsed.combat?.recoil || fallback.combat.recoil),
      hitRange: Number(parsed.combat?.hitRange || fallback.combat.hitRange),
      hitRadius: Number(parsed.combat?.hitRadius || fallback.combat.hitRadius),
      damage: Number(parsed.combat?.damage || fallback.combat.damage),
    },
    provider: provider.provider,
    model: provider.model,
  };
}

function buildFallbackPlan(prompt, sourceName, projectName, runId) {
  const title = extractTitle(prompt) || projectName || `Splat Game ${runId.slice(0, 4)}`;
  const mechanics = buildMechanics(prompt);
  return {
    title,
    summary: `${title} uses ${sourceName} as the world source, with collision, navmesh, humanoid NPCs, a first-person weapon, and a browser share build.`,
    mechanics,
    npcArchetypes: expandNpcArchetypes([
      { name: 'Scout', role: 'Patrol', behavior: 'circle the main chamber and alert others on contact.' },
      { name: 'Guard', role: 'Anchor', behavior: 'hold chokepoints and pressure the player line.' },
      { name: 'Hunter', role: 'Chase', behavior: 'path toward noise and pursue the player aggressively.' },
    ]),
    objective: 'Reach the energy core and escape the building.',
    publishTag: 'local-preview',
    snapshotCaption: 'PlayCanvas scene, humanoid NPCs, weapon model, collision, and navmesh are ready.',
    characterStyle: 'open-source humanoid rigs with tactical silhouettes',
    weaponStyle: 'procedural first-person rifle viewmodel',
    combat: {
      fireRate: 7.8,
      magazineSize: 24,
      reloadTime: 1.7,
      recoil: 0.23,
      hitRange: 14,
      hitRadius: 0.9,
      damage: 25,
    },
  };
}

function expandNpcArchetypes(input) {
  const seeds = Array.isArray(input) && input.length ? input : [];
  const fallback = [
    { name: 'Scout', role: 'Patrol', behavior: 'circle the main chamber and alert others on contact.' },
    { name: 'Guard', role: 'Anchor', behavior: 'hold chokepoints and pressure the player line.' },
    { name: 'Hunter', role: 'Chase', behavior: 'path toward noise and pursue the player aggressively.' },
    { name: 'Warden', role: 'Flank', behavior: 'moves around cover and cuts off escape routes.' },
  ];
  const source = seeds.length ? seeds : fallback;
  return Array.from({ length: 8 }, (_, index) => {
    const base = source[index % source.length] || fallback[index % fallback.length];
    const name = String(base.name || fallback[index % fallback.length].name);
    return {
      name: index < source.length ? name : `${name} ${Math.floor(index / source.length) + 1}`,
      role: String(base.role || fallback[index % fallback.length].role),
      behavior: String(base.behavior || fallback[index % fallback.length].behavior),
    };
  });
}

function buildGameplayRuntime(plan, runId) {
  const npcCount = Math.max(8, plan.npcArchetypes.length || 8);
  const npcs = Array.from({ length: npcCount }, (_, index) => {
    const angle = (index / npcCount) * Math.PI * 2;
    const radius = 4.5 + (index % 3) * 1.35;
    const archetype = plan.npcArchetypes[index % plan.npcArchetypes.length];
    return {
      id: `npc-${index + 1}`,
      name: archetype?.name || `NPC ${index + 1}`,
      role: archetype?.role || 'Patrol',
      behavior: archetype?.behavior || 'patrol and investigate the player.',
      spawn: [Number((Math.cos(angle) * radius).toFixed(2)), 0.65, Number((Math.sin(angle) * radius).toFixed(2))],
      route: [
        [Number((Math.cos(angle) * radius).toFixed(2)), 0.65, Number((Math.sin(angle) * radius).toFixed(2))],
        [Number((Math.cos(angle + 0.85) * (radius + 1.4)).toFixed(2)), 0.65, Number((Math.sin(angle + 0.85) * (radius + 1.4)).toFixed(2))],
        [Number((Math.cos(angle + 1.7) * Math.max(2.2, radius - 1.1)).toFixed(2)), 0.65, Number((Math.sin(angle + 1.7) * Math.max(2.2, radius - 1.1)).toFixed(2))],
      ],
      awarenessRadius: Number((3.4 + (index % 3) * 0.55).toFixed(2)),
      speed: Number((0.75 + (index % 4) * 0.08).toFixed(2)),
      health: 2,
    };
  });
  const combat = plan.combat || {
    fireRate: 7.8,
    magazineSize: 24,
    reloadTime: 1.7,
    recoil: 0.23,
    hitRange: 14,
    hitRadius: 0.9,
    damage: 25,
  };

  return {
    id: `runtime-${runId}`,
    camera: 'first-person-fps-preview',
    controls: {
      move: 'WASD / arrow keys',
      look: 'drag mouse',
      zoom: 'mouse wheel',
      fire: 'space, click, or left mouse button',
      reload: 'R',
    },
    player: {
      spawn: [0, 0.7, 7.8],
      speed: 4.2,
      health: 100,
      ammo: combat.magazineSize,
    },
    assets: {
      humanoidUrl: humanoidAssetUrl,
      fallbackHumanoidUrl: fallbackHumanoidAssetUrl,
      weaponStyle: 'procedural-fps-rifle',
      playerScale: 1,
      npcScale: 1,
    },
    combat: {
      fireRate: combat.fireRate,
      magazineSize: combat.magazineSize,
      reloadTime: combat.reloadTime,
      recoil: combat.recoil,
      hitRange: combat.hitRange,
      hitRadius: combat.hitRadius,
      damage: combat.damage,
    },
    objective: {
      id: 'energy-core',
      title: plan.objective || 'Reach the energy core and extract.',
      position: [0, 0.85, -3.2],
      radius: 1.6,
      requiredTags: Math.min(3, npcs.length),
    },
    npcs,
    winCondition: 'Tag enough patrols and reach the energy core.',
  };
}

function buildBehaviorTree(plan, runtimeSpec) {
  return {
    id: `${runtimeSpec.id}-behavior-tree`,
    title: `${plan.title} behavior tree`,
    blackboard: ['playerPosition', 'lastNoisePosition', 'energyCorePosition', 'alertLevel', 'health', 'lineOfSight'],
    root: {
      type: 'selector',
      children: [
        {
          type: 'sequence',
          name: 'Engage visible player',
          children: ['hasLineOfSight', 'closeDistance', 'fireBurst', 'requestBackup'],
        },
        {
          type: 'sequence',
          name: 'Take cover and flank',
          children: ['lowHealth', 'chooseCover', 'flankPlayer', 'peekAndFire'],
        },
        {
          type: 'sequence',
          name: 'Investigate noise',
          children: ['heardNoise', 'moveToLastNoise', 'scanArea', 'faceThreat'],
        },
        {
          type: 'sequence',
          name: 'Patrol route',
          children: ['chooseNextWaypoint', 'followNavmeshPath', 'lookAround', 'broadcastSightline'],
        },
      ],
    },
    agents: runtimeSpec.npcs.map((npc) => ({
      id: npc.id,
      archetype: npc.role,
      route: npc.route,
      awarenessRadius: npc.awarenessRadius,
      health: npc.health,
    })),
  };
}

function parseLikelyJson(text) {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const blocks = trimmed.match(/\{[\s\S]*\}/g);
  if (!blocks?.length) {
    return null;
  }

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(blocks[index]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createSnapshotSvg({ title, prompt, sourceName, summary, mechanics, npcArchetypes, publishTag }) {
  const mechanicsList = mechanics.slice(0, 5).map((item, index) => {
    const x = 72 + (index % 2) * 266;
    const y = 360 + Math.floor(index / 2) * 58;
    return `
      <g>
        <rect x="${x}" y="${y}" rx="18" ry="18" width="236" height="40" fill="rgba(255,255,255,0.08)" />
        <text x="${x + 18}" y="${y + 26}" fill="#dff7ff" font-size="15" font-weight="700">${escapeXml(item)}</text>
      </g>
    `;
  }).join('');

  const npcLines = npcArchetypes.slice(0, 3).map((item, index) => {
    const y = 520 + index * 28;
    return `<text x="72" y="${y}" fill="#bfefff" font-size="14" font-weight="700">${escapeXml(item.name)} • ${escapeXml(item.role)} • ${escapeXml(item.behavior)}</text>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="${escapeXml(title)} snapshot">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f5ea6" />
      <stop offset="52%" stop-color="#06253d" />
      <stop offset="100%" stop-color="#03111d" />
    </linearGradient>
    <linearGradient id="panel" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.08)" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="rgba(105,225,255,0.45)" />
      <stop offset="100%" stop-color="rgba(105,225,255,0)" />
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)" />
  <circle cx="1020" cy="110" r="220" fill="url(#glow)" />
  <circle cx="270" cy="570" r="160" fill="rgba(41,184,255,0.18)" />
  <rect x="56" y="48" width="1168" height="624" rx="38" fill="rgba(5,18,31,0.6)" stroke="rgba(152,231,255,0.25)" />
  <rect x="72" y="72" width="1136" height="232" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(152,231,255,0.22)" />
  <text x="96" y="126" fill="#8be1ff" font-size="20" font-weight="800" letter-spacing="4">${escapeXml(publishTag.toUpperCase())}</text>
  <text x="96" y="186" fill="#ffffff" font-size="52" font-weight="900">${escapeXml(title)}</text>
  <text x="96" y="230" fill="#d8f4ff" font-size="24" font-weight="700">${escapeXml(sourceName)}</text>
  <text x="96" y="268" fill="#b7d7e9" font-size="18" font-weight="600">${escapeXml(summary)}</text>
  <rect x="72" y="324" width="1136" height="286" rx="28" fill="rgba(3,15,24,0.78)" stroke="rgba(152,231,255,0.16)" />
  ${mechanicsList}
  <text x="740" y="386" fill="#87deff" font-size="16" font-weight="800" letter-spacing="2">NPC PLAN</text>
  ${npcLines}
  <text x="740" y="552" fill="#87deff" font-size="16" font-weight="800" letter-spacing="2">SNAPSHOT</text>
  <text x="740" y="586" fill="#ffffff" font-size="24" font-weight="800">${escapeXml(prompt.slice(0, 72))}${prompt.length > 72 ? '...' : ''}</text>
  <text x="740" y="624" fill="#b7d7e9" font-size="16" font-weight="700">${escapeXml('PlayCanvas preview + SOG stream + collision + navmesh')}</text>
</svg>`;
}

function createPublishedHtml({ title, summary, snapshotUrl, publishUrl, sourceUrl, streamedUrl, collisionUrl, navmeshUrl, runtimeUrl, behaviorTreeUrl, objective, mechanics, npcArchetypes, published = false }) {
  const mechanicsMarkup = mechanics.map((item) => `<span>${escapeHtml(item)}</span>`).join('');
  const npcMarkup = npcArchetypes.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.role)} - ${escapeHtml(item.behavior)}</span></li>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        background: linear-gradient(145deg, #0f3350, #06121f 66%, #030c14);
        color: #eaf8ff;
        font-family: Inter, system-ui, sans-serif;
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }
      .hero {
        border-radius: 28px;
        overflow: hidden;
        border: 1px solid rgba(150, 231, 255, 0.22);
        background: rgba(255,255,255,0.05);
        box-shadow: 0 24px 70px rgba(0,0,0,0.3);
      }
      .hero img { display: block; width: 100%; height: auto; }
      .grid {
        display: grid;
        grid-template-columns: 1.25fr 0.75fr;
        gap: 18px;
        margin-top: 18px;
      }
      .panel {
        border-radius: 24px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(150, 231, 255, 0.16);
        padding: 18px;
      }
      .pill-row { display:flex; flex-wrap: wrap; gap: 8px; }
      .pill {
        border-radius: 999px;
        background: rgba(96, 215, 255, 0.16);
        color: #dff8ff;
        padding: 8px 12px;
        font-weight: 700;
        font-size: 13px;
      }
      ul { margin: 0; padding-left: 18px; }
      li { margin-bottom: 8px; }
      a.button {
        display: inline-flex;
        margin-top: 14px;
        padding: 12px 18px;
        border-radius: 999px;
        background: linear-gradient(135deg, #55d3ff, #287eff);
        color: white;
        text-decoration: none;
        font-weight: 800;
      }
      code {
        display: block;
        padding: 12px;
        border-radius: 16px;
        background: rgba(3, 15, 24, 0.72);
        color: #bcefff;
        overflow-x: auto;
      }
      .muted { color: rgba(234, 248, 255, 0.72); }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="hero">
        <img src="${escapeHtml(snapshotUrl)}" alt="${escapeHtml(title)} snapshot" />
      </div>
      <div class="grid">
        <section class="panel">
          <h1>${escapeHtml(title)}</h1>
          <p class="muted">${escapeHtml(summary)}</p>
          <h2>Objective</h2>
          <p>${escapeHtml(objective || 'Reach the objective, survive the patrols, and extract.')}</p>
          <div class="pill-row">${mechanicsMarkup}</div>
          <a class="button" href="/#create">${published ? 'Open Studio' : 'Back to Studio'}</a>
        </section>
        <aside class="panel">
          <h2>Asset links</h2>
          <code>${escapeHtml(sourceUrl)}\n${escapeHtml(streamedUrl)}\n${escapeHtml(collisionUrl)}\n${escapeHtml(navmeshUrl)}\n${escapeHtml(runtimeUrl || '')}\n${escapeHtml(behaviorTreeUrl || '')}\n${escapeHtml(publishUrl)}</code>
          <h2 style="margin-top:18px;">NPC plan</h2>
          <ul>${npcMarkup}</ul>
        </aside>
      </div>
    </main>
  </body>
</html>`;
}

async function serveWorkspaceAsset(req, res, pathname) {
  const relativePath = pathname.replace(/^\/workspace\//, '');
  const parts = relativePath.split('/').filter(Boolean).map(decodeURIComponent);
  const filePath = resolve(workspaceRoot, ...parts);
  if (!filePath.startsWith(workspaceRoot)) {
    sendJson(res, 403, { error: 'Invalid workspace path.' });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: 'Workspace asset not found.' });
    return;
  }

  const stats = await fs.stat(filePath);
  if (stats.isDirectory()) {
    sendJson(res, 404, { error: 'Workspace directory cannot be served directly.' });
    return;
  }

  const contentType = contentTypeFor(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  createReadStream(filePath).pipe(res);
}

async function writeProjectManifest(projectId, manifest) {
  await ensureProjectFolder(projectId);
  const manifestPath = getProjectManifestPath(projectId);
  await writeJson(manifestPath, normalizeManifest(projectId, manifest));
}

async function ensureProjectFolder(projectId) {
  await ensureDir(join(workspaceRoot, projectId));
  await ensureDir(join(workspaceRoot, projectId, 'source'));
  await ensureDir(join(workspaceRoot, projectId, 'runs'));
}

function normalizeManifest(projectId, manifest) {
  const next = {
    ...manifest,
    id: projectId,
    name: String(manifest.name ?? `Splat Game ${projectId.slice(0, 4)}`),
    prompt: String(manifest.prompt ?? ''),
    modelName: String(manifest.modelName ?? ''),
    modelSource: manifest.modelSource === 'uploaded' ? 'uploaded' : 'builtin',
    modelUrl: String(manifest.modelUrl ?? ''),
    status: manifest.status === 'published' ? 'published' : manifest.status === 'generated' ? 'generated' : 'draft',
    createdAt: String(manifest.createdAt ?? nowIso()),
    updatedAt: String(manifest.updatedAt ?? nowIso()),
    source: manifest.source ? normalizeSource(projectId, manifest.source) : null,
    runs: Array.isArray(manifest.runs) ? manifest.runs.map((run) => normalizeRun(projectId, run)) : [],
  };

  if (manifest.latestRunId) {
    next.latestRunId = String(manifest.latestRunId);
  }
  if (manifest.latestRunPath) {
    next.latestRunPath = String(manifest.latestRunPath);
  }
  if (manifest.publishedUrl) {
    next.publishedUrl = String(manifest.publishedUrl);
  }
  return next;
}

function normalizeRun(projectId, run) {
  return {
    ...run,
    id: String(run.id),
    title: String(run.title ?? ''),
    summary: String(run.summary ?? ''),
    mechanics: Array.isArray(run.mechanics) ? run.mechanics.map((item) => String(item)) : [],
    shareUrl: String(run.shareUrl ?? ''),
    createdAt: String(run.createdAt ?? nowIso()),
    sourceUrl: String(run.sourceUrl ?? ''),
    streamedUrl: String(run.streamedUrl ?? ''),
    collisionUrl: String(run.collisionUrl ?? ''),
    navmeshUrl: String(run.navmeshUrl ?? ''),
    runtimeUrl: String(run.runtimeUrl ?? ''),
    behaviorTreeUrl: String(run.behaviorTreeUrl ?? ''),
    snapshotUrl: String(run.snapshotUrl ?? ''),
    publishUrl: String(run.publishUrl ?? ''),
    workspacePath: String(run.workspacePath ?? ''),
    npcArchetypes: Array.isArray(run.npcArchetypes) ? run.npcArchetypes.map((item) => ({
      name: String(item.name ?? ''),
      role: String(item.role ?? ''),
      behavior: String(item.behavior ?? ''),
    })) : [],
    objective: String(run.objective ?? ''),
    publishTag: String(run.publishTag ?? ''),
  };
}

function normalizeSource(projectId, source) {
  return {
    ...source,
    fileName: String(source.fileName ?? `${projectId}.ply`),
    path: String(source.path ?? ''),
    url: String(source.url ?? ''),
    kind: source.kind === 'uploaded' ? 'uploaded' : 'builtin',
    size: Number(source.size ?? 0),
  };
}

function getProjectDir(projectId) {
  return join(workspaceRoot, projectId);
}

function getProjectManifestPath(projectId) {
  return join(getProjectDir(projectId), 'project.json');
}

function workspaceUrl(projectId, segments) {
  return `/workspace/${encodeURIComponent(projectId)}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function getUploadName(req) {
  const headerName = req.headers['x-filename'];
  if (typeof headerName === 'string' && headerName.trim()) {
    return headerName;
  }

  const disposition = req.headers['content-disposition'];
  if (typeof disposition === 'string') {
    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match) {
      return match[1];
    }
  }

  return 'upload.ply';
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'upload.ply';
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) {
    return {};
  }

  return JSON.parse(raw.toString('utf8'));
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) {
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function runCommand(command, args, options = {}) {
  const env = options.env ? options.env : options;
  const timeoutMs = Number(options.timeoutMs ?? 0);
  const shell = process.platform === 'win32';
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: root,
      shell,
      env: {
        ...process.env,
        ...env,
      },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGTERM');
        resolvePromise({
          ok: false,
          code: -1,
          stdout,
          stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms.`,
        });
      }, timeoutMs)
      : undefined;

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolvePromise({
        ok: code === 0,
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function getNodeOptionsEnv() {
  return process.platform === 'win32'
    ? { NODE_OPTIONS: '--max-old-space-size=8192' }
    : {};
}

async function ensureRecast() {
  if (!recastReady) {
    recastReady = initRecast();
  }

  await recastReady;
}

function pickPiProvider() {
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      model: process.env.PI_MODEL ?? 'gpt-4o-mini',
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      model: process.env.PI_MODEL ?? 'claude-sonnet-4',
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      model: process.env.PI_MODEL ?? 'openai/gpt-4o-mini',
    };
  }

  return null;
}

function transformPoint(matrix, point, target) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  target[0] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  target[1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  target[2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  return target;
}

function expandBounds(bounds, point) {
  for (let index = 0; index < 3; index += 1) {
    bounds.min[index] = Math.min(bounds.min[index], point[index]);
    bounds.max[index] = Math.max(bounds.max[index], point[index]);
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(value) {
  return escapeXml(value);
}

function nowIso() {
  return new Date().toISOString();
}

function createRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-')}-${randomUUID().slice(0, 8)}`;
}

function extractTitle(prompt) {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  const phrase = clean.split(/[，。,.?!]/)[0] || 'Generated Splat FPS';
  const withoutLead = phrase.replace(/^turn my\s+/i, '').replace(/^make\s+/i, '');
  return withoutLead.length > 34 ? `${withoutLead.slice(0, 34)}...` : withoutLead;
}

function buildMechanics(prompt) {
  const lower = prompt.toLowerCase();
  const mechanics = ['FPS movement', 'Splat scene', 'Collision GLB', 'Recast navmesh', 'Humanoid NPCs', 'Weapon recoil', 'Share build'];

  if (lower.includes('collect') || prompt.includes('收集')) {
    mechanics.push('Collection objective');
  }

  if (lower.includes('stealth') || prompt.includes('潜行')) {
    mechanics.push('Enemy awareness');
  }

  if (lower.includes('timer') || prompt.includes('计时')) {
    mechanics.push('Timed extraction');
  }

  return Array.from(new Set(mechanics)).slice(0, 8);
}

function contentTypeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.bin') return 'application/octet-stream';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.sog' || ext === '.ply' || ext === '.voxel') return 'application/octet-stream';
  return 'application/octet-stream';
}

async function ensureDir(path) {
  await fs.mkdir(path, { recursive: true });
}

async function writeJson(path, value) {
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function storeWorkspaceBootstrap() {
  await ensureDir(workspaceRoot);
}

storeWorkspaceBootstrap().catch(() => {});
