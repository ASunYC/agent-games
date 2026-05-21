import {
  Asset,
  Application,
  Color,
  Entity,
  FILLMODE_NONE,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from 'playcanvas';

type NpcArchetype = {
  name: string;
  role: string;
  behavior: string;
};

type RuntimeNpc = NpcArchetype & {
  id: string;
  spawn: [number, number, number];
  route: Array<[number, number, number]>;
  awarenessRadius: number;
  speed: number;
  health: number;
};

type RuntimeSpec = {
  player?: {
    spawn?: [number, number, number];
    speed?: number;
    health?: number;
    ammo?: number;
  };
  objective?: {
    title?: string;
    position?: [number, number, number];
    radius?: number;
    requiredTags?: number;
  };
  npcs?: RuntimeNpc[];
};

export type PreviewState = {
  status: 'draft' | 'generated' | 'published';
  modelName: string;
  sceneLabel: string;
  modelUrl?: string;
  fallbackModelUrl?: string;
  flipVertical?: boolean;
  collisionUrl?: string;
  navmeshUrl?: string;
  runtimeUrl?: string;
  behaviorTreeUrl?: string;
  npcArchetypes?: NpcArchetype[];
  objective?: string;
  versionCount: number;
  mechanics: string[];
  generationStep?: number;
};

export type GamePreviewRuntime = {
  destroy: () => void;
};

export function mountGamePreview(canvas: HTMLCanvasElement, state: PreviewState): GamePreviewRuntime {
  const app = new Application(canvas, {
    graphicsDeviceOptions: {
      alpha: true,
    },
  });
  const focusPoint = new Vec3(0, 1, 0);
  let yaw = 0;
  let pitch = 0.28;
  let distance = 18;
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pointerTravel = 0;
  let previewPanX = 0;
  let previewPanY = 0;
  let previewZoom = 1.06;
  let loadTimer: number | undefined;
  const keys = new Set<string>();
  const playerPosition = new Vec3(0, 0.7, 7.8);
  const objectivePosition = new Vec3(0, 0.85, -3.2);
  let playerYaw = 0;
  let runtimeSpec: RuntimeSpec | undefined;
  let playerEntity: Entity | undefined;
  let objectiveEntity: Entity | undefined;
  let collisionEntity: Entity | undefined;
  let navmeshBytes = 0;
  let taggedEnemies = 0;
  let objectiveComplete = false;
  let ammo = 24;
  const runtimeNpcs: Array<{
    spec: RuntimeNpc;
    entity: Entity;
    state: 'patrol' | 'chase' | 'tagged';
    routeIndex: number;
  }> = [];
  const previewSurface = canvas.closest<HTMLElement>('.preview-card');
  const previewStatus = previewSurface?.querySelector<HTMLElement>('[data-preview-status]');
  const runtimeStatus = previewSurface?.querySelector<HTMLElement>('[data-runtime-status]');
  const runtimeObjective = previewSurface?.querySelector<HTMLElement>('[data-runtime-objective]');
  const runtimeEnemies = previewSurface?.querySelector<HTMLElement>('[data-runtime-enemies]');
  previewSurface?.classList.add('is-loading');
  canvas.tabIndex = 0;
  if (previewStatus) {
    previewStatus.textContent = 'Preparing unified preview';
  }
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    app.resizeCanvas(Math.max(1, Math.floor(bounds.width)), Math.max(1, Math.floor(bounds.height)));
  };
  const updateFallbackPreview = () => {
    previewSurface?.style.setProperty('--preview-pan-x', `${previewPanX}px`);
    previewSurface?.style.setProperty('--preview-pan-y', `${previewPanY}px`);
    previewSurface?.style.setProperty('--preview-zoom', `${previewZoom}`);
  };
  const updateCamera = () => {
    const horizontal = Math.cos(pitch) * distance;
    camera.setPosition(
      focusPoint.x + Math.sin(yaw) * horizontal,
      focusPoint.y + Math.sin(pitch) * distance,
      focusPoint.z + Math.cos(yaw) * horizontal,
    );
    camera.lookAt(focusPoint);
  };
  const pointerDown = (event: PointerEvent) => {
    dragging = true;
    pointerTravel = 0;
    canvas.focus({ preventScroll: true });
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }

    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    pointerTravel += Math.abs(dx) + Math.abs(dy);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    yaw -= dx * 0.006;
    pitch = clamp(pitch + dy * 0.004, -0.18, 1.15);
    previewPanX = clamp(previewPanX + dx * 0.22, -90, 90);
    previewPanY = clamp(previewPanY + dy * 0.18, -70, 70);
    playerYaw = yaw;
    updateCamera();
    updateFallbackPreview();
  };
  const pointerUp = (event: PointerEvent) => {
    if (dragging && pointerTravel < 5) {
      tagNearestNpc();
    }
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    distance = clamp(distance + event.deltaY * 0.018, 7, 42);
    previewZoom = clamp(previewZoom - event.deltaY * 0.0012, 1, 1.42);
    updateCamera();
    updateFallbackPreview();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!isPreviewInputActive(canvas)) {
      return;
    }

    keys.add(event.key.toLowerCase());
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      tagNearestNpc();
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    keys.delete(event.key.toLowerCase());
  };

  app.setCanvasFillMode(FILLMODE_NONE);
  app.setCanvasResolution(RESOLUTION_AUTO);
  app.scene.ambientLight = new Color(0.34, 0.38, 0.36);

  resize();
  updateFallbackPreview();
  window.addEventListener('resize', resize);

  const camera = createCamera(app);
  const materials = createRuntimeMaterials();
  updateCamera();
  setupRuntimeScaffold();
  void hydrateGeneratedRuntime();

  const startSplatLoad = () => {
    loadGaussianSplat(
      app,
      [state.modelUrl, state.fallbackModelUrl],
      Boolean(state.flipVertical),
      {
        onProgress(percent) {
          if (previewStatus) {
            previewStatus.textContent = percent
              ? `Streaming Gaussian scene ${percent}%`
              : 'Streaming Gaussian scene';
          }
        },
        onReady(url) {
          previewSurface?.classList.remove('is-loading');
          previewSurface?.classList.add('is-live');
          if (previewStatus) {
            previewStatus.textContent = url.endsWith('.ply')
              ? 'PLY loaded in PlayCanvas'
              : 'Streamed SOG loaded in PlayCanvas';
          }
        },
        onError() {
          if (previewStatus) {
            previewStatus.textContent = 'Trying fallback splat source';
          }
        },
      },
    );
  };
  const shouldLoadImmediately = (state.generationStep ?? Number.MAX_SAFE_INTEGER) >= 3;
  if (shouldLoadImmediately) {
    startSplatLoad();
  } else {
    loadTimer = window.setTimeout(startSplatLoad, 2600);
  }

  app.on('update', (dt) => {
    updateRuntime(dt);
    updateCamera();
  });

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  app.start();

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      if (loadTimer) {
        window.clearTimeout(loadTimer);
      }
      previewSurface?.classList.remove('is-loading', 'is-live');
      app.destroy();
    },
  };

  function setupRuntimeScaffold() {
    const spawn = runtimeSpec?.player?.spawn ?? [0, 0.7, 7.8];
    playerPosition.set(spawn[0], spawn[1], spawn[2]);
    focusPoint.copy(playerPosition);

    playerEntity = createRuntimeEntity('player-beacon', 'capsule', materials.player);
    playerEntity.setLocalScale(0.38, 0.78, 0.38);
    playerEntity.setPosition(playerPosition);
    app.root.addChild(playerEntity);

    objectiveEntity = createRuntimeEntity('energy-core-objective', 'sphere', materials.objective);
    objectiveEntity.setLocalScale(0.7, 0.7, 0.7);
    objectiveEntity.setPosition(objectivePosition);
    app.root.addChild(objectiveEntity);
    updateRuntimeHud('Playable runtime ready');
  }

  async function hydrateGeneratedRuntime() {
    runtimeSpec = await loadRuntimeSpec(state.runtimeUrl, state.npcArchetypes, state.objective);
    const spawn = runtimeSpec.player?.spawn ?? [0, 0.7, 7.8];
    playerPosition.set(spawn[0], spawn[1], spawn[2]);
    playerEntity?.setPosition(playerPosition);
    const objective = runtimeSpec.objective?.position ?? [0, 0.85, -3.2];
    objectivePosition.set(objective[0], objective[1], objective[2]);
    objectiveEntity?.setPosition(objectivePosition);
    ammo = runtimeSpec.player?.ammo ?? ammo;
    spawnRuntimeNpcs(runtimeSpec.npcs ?? createFallbackNpcs(state.npcArchetypes));
    await Promise.all([
      loadCollisionPreview(state.collisionUrl),
      loadNavmeshMetadata(state.navmeshUrl),
    ]);
    updateRuntimeHud('Runtime loaded from generated assets');
  }

  function spawnRuntimeNpcs(npcs: RuntimeNpc[]) {
    runtimeNpcs.splice(0).forEach((npc) => npc.entity.destroy());
    npcs.slice(0, 8).forEach((npc, index) => {
      const entity = createRuntimeEntity(npc.id || `npc-${index + 1}`, 'capsule', materials.npc);
      const spawn = npc.spawn ?? [Math.cos(index) * 4, 0.65, Math.sin(index) * 4];
      entity.setPosition(spawn[0], spawn[1], spawn[2]);
      entity.setLocalScale(0.34, 0.72, 0.34);
      app.root.addChild(entity);
      runtimeNpcs.push({
        spec: npc,
        entity,
        state: 'patrol',
        routeIndex: 0,
      });
    });
  }

  function updateRuntime(dt: number) {
    const speed = (runtimeSpec?.player?.speed ?? 4.2) * (keys.has('shift') ? 1.65 : 1);
    const moveX = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const moveZ = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (moveX || moveZ) {
      const sin = Math.sin(playerYaw);
      const cos = Math.cos(playerYaw);
      const forwardX = sin;
      const forwardZ = cos;
      const rightX = cos;
      const rightZ = -sin;
      playerPosition.x += (rightX * moveX + forwardX * moveZ) * speed * dt;
      playerPosition.z += (rightZ * moveX + forwardZ * moveZ) * speed * dt;
      playerPosition.x = clamp(playerPosition.x, -10, 10);
      playerPosition.z = clamp(playerPosition.z, -10, 10);
      playerEntity?.setPosition(playerPosition);
      focusPoint.lerp(focusPoint, playerPosition, 0.12);
    }

    runtimeNpcs.forEach((npc) => updateNpc(npc, dt));
    objectiveEntity?.rotate(0, 55 * dt, 0);
    playerEntity?.setEulerAngles(0, (playerYaw * 180) / Math.PI, 0);
    const objectiveRadius = runtimeSpec?.objective?.radius ?? 1.6;
    const requiredTags = runtimeSpec?.objective?.requiredTags ?? 3;
    objectiveComplete = taggedEnemies >= requiredTags && playerPosition.distance(objectivePosition) <= objectiveRadius;
    updateRuntimeHud(objectiveComplete ? 'Objective complete' : undefined);
  }

  function updateNpc(npc: (typeof runtimeNpcs)[number], dt: number) {
    if (npc.state === 'tagged') {
      npc.entity.rotate(0, 80 * dt, 0);
      return;
    }

    const npcPosition = npc.entity.getPosition();
    const awareness = npc.spec.awarenessRadius ?? 3.5;
    npc.state = npcPosition.distance(playerPosition) < awareness ? 'chase' : 'patrol';
    const target = npc.state === 'chase'
      ? playerPosition
      : vecFromTuple(npc.spec.route?.[npc.routeIndex] ?? npc.spec.spawn ?? [0, 0.65, 0]);
    const direction = target.clone().sub(npcPosition);
    const distanceToTarget = direction.length();
    if (distanceToTarget > 0.05) {
      direction.normalize();
      const npcSpeed = (npc.spec.speed ?? 0.8) * (npc.state === 'chase' ? 1.45 : 1);
      npc.entity.setPosition(npcPosition.add(direction.mulScalar(npcSpeed * dt)));
      npc.entity.lookAt(target);
    } else if (npc.state === 'patrol') {
      npc.routeIndex = (npc.routeIndex + 1) % Math.max(1, npc.spec.route?.length ?? 1);
    }
  }

  function tagNearestNpc() {
    if (!runtimeNpcs.length || ammo <= 0) {
      return;
    }

    ammo -= 1;
    const alive = runtimeNpcs.filter((npc) => npc.state !== 'tagged');
    const nearest = alive
      .map((npc) => ({ npc, distance: npc.entity.getPosition().distance(playerPosition) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest || nearest.distance > 6) {
      updateRuntimeHud('No target in range');
      return;
    }

    nearest.npc.state = 'tagged';
    nearest.npc.entity.render?.meshInstances.forEach((mesh) => {
      mesh.material = materials.tagged;
    });
    taggedEnemies += 1;
    updateRuntimeHud(`Tagged ${nearest.npc.spec.name}`);
  }

  function updateRuntimeHud(message?: string) {
    if (runtimeStatus && message) {
      runtimeStatus.textContent = `${message} · WASD move · drag look · space tag`;
    }
    if (runtimeObjective) {
      runtimeObjective.textContent = runtimeSpec?.objective?.title || state.objective || 'Reach the energy core';
    }
    if (runtimeEnemies) {
      const remaining = runtimeNpcs.filter((npc) => npc.state !== 'tagged').length;
      runtimeEnemies.textContent = `${remaining}/${runtimeNpcs.length || 8} patrols active · ammo ${ammo} · nav ${navmeshBytes ? `${Math.round(navmeshBytes / 1024)}KB` : 'pending'}`;
    }
  }

  function createRuntimeEntity(name: string, type: 'capsule' | 'sphere', material: StandardMaterial) {
    const entity = new Entity(name);
    entity.addComponent('render', {
      type,
      material,
    });
    return entity;
  }

  async function loadCollisionPreview(url?: string) {
    if (!url) {
      return;
    }

    const asset = new Asset(`collision-${Date.now()}`, 'container', { url });
    app.assets.add(asset);
    await new Promise<void>((resolve) => {
      asset.ready((readyAsset) => {
        const resource = readyAsset.resource as { instantiateRenderEntity?: () => Entity };
        collisionEntity = resource.instantiateRenderEntity?.();
        if (collisionEntity) {
          collisionEntity.name = 'hidden-collision-glb';
          collisionEntity.enabled = false;
          app.root.addChild(collisionEntity);
        }
        resolve();
      });
      asset.on('error', () => resolve());
      app.assets.load(asset);
    });
  }

  async function loadNavmeshMetadata(url?: string) {
    if (!url) {
      return;
    }

    try {
      const response = await fetch(url, { cache: 'no-store' });
      const bytes = await response.arrayBuffer();
      navmeshBytes = bytes.byteLength;
    } catch {
      navmeshBytes = 0;
    }
  }

  function createRuntimeMaterials() {
    return {
      player: makeMaterial('#75e6ff', '#1b6d86'),
      npc: makeMaterial('#ff6d7a', '#6f1624'),
      tagged: makeMaterial('#94f7a7', '#1f6a35'),
      objective: makeMaterial('#ffe66e', '#8d7215'),
    };
  }
}

function loadGaussianSplat(
  app: Application,
  urls: Array<string | undefined>,
  flipVertical: boolean,
  events: {
    onProgress?: (percent: string) => void;
    onReady?: (url: string) => void;
    onError?: () => void;
  },
  index = 0,
) {
  const candidates = urls.filter(Boolean) as string[];
  const url = candidates[index];

  if (!url) {
    return;
  }

  const asset = new Asset(`gaussian-splat-${index}-${Date.now()}`, 'gsplat', { url });
  app.assets.add(asset);

  asset.on('progress', (receivedBytes: number, totalBytes: number) => {
    if (!totalBytes) {
      events.onProgress?.('');
      return;
    }

    events.onProgress?.(`${Math.min(100, (receivedBytes / totalBytes) * 100).toFixed(0)}`);
  });

  asset.ready((readyAsset) => {
    const splat = new Entity('gaussian-splat');
    splat.addComponent('gsplat', {
      asset: readyAsset,
    });
    splat.setPosition(0, 0, 0);
    splat.setLocalScale(1, 1, 1);
    if (flipVertical) {
      splat.setEulerAngles(0, 0, 180);
    }
    app.root.addChild(splat);
    events.onReady?.(url);
  });

  asset.on('error', () => {
    events.onError?.();
    app.assets.remove(asset);
    loadGaussianSplat(app, candidates, flipVertical, events, index + 1);
  });

  app.assets.load(asset);
}

function createCamera(app: Application) {
  const camera = new Entity('preview-camera');
  camera.addComponent('camera', {
    clearColor: new Color(0.04, 0.07, 0.09),
    clearColorBuffer: false,
    fov: 56,
    nearClip: 0.1,
    farClip: 240,
  });
  app.root.addChild(camera);
  camera.setPosition(0, 5.3, 17.2);
  return camera;
}

async function loadRuntimeSpec(url: string | undefined, archetypes: NpcArchetype[] | undefined, objective: string | undefined): Promise<RuntimeSpec> {
  if (url) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        return await response.json() as RuntimeSpec;
      }
    } catch {
      // The preview can still run with deterministic local gameplay data.
    }
  }

  return {
    player: {
      spawn: [0, 0.7, 7.8],
      speed: 4.2,
      health: 100,
      ammo: 24,
    },
    objective: {
      title: objective || 'Reach the energy core and extract.',
      position: [0, 0.85, -3.2],
      radius: 1.6,
      requiredTags: 3,
    },
    npcs: createFallbackNpcs(archetypes),
  };
}

function createFallbackNpcs(archetypes: NpcArchetype[] | undefined): RuntimeNpc[] {
  const fallback = archetypes?.length ? archetypes : [
    { name: 'Scout', role: 'Patrol', behavior: 'circle the scene and alert nearby enemies.' },
    { name: 'Guard', role: 'Anchor', behavior: 'hold central lanes and pressure the player.' },
    { name: 'Hunter', role: 'Chase', behavior: 'pursue the player when close.' },
  ];

  return Array.from({ length: 8 }, (_, index) => {
    const archetype = fallback[index % fallback.length];
    const angle = (index / 8) * Math.PI * 2;
    const radius = 4.5 + (index % 3) * 1.2;
    const spawn: [number, number, number] = [
      Number((Math.cos(angle) * radius).toFixed(2)),
      0.65,
      Number((Math.sin(angle) * radius).toFixed(2)),
    ];
    return {
      id: `npc-${index + 1}`,
      name: index < fallback.length ? archetype.name : `${archetype.name} ${Math.floor(index / fallback.length) + 1}`,
      role: archetype.role,
      behavior: archetype.behavior,
      spawn,
      route: [
        spawn,
        [Number((Math.cos(angle + 0.85) * (radius + 1.2)).toFixed(2)), 0.65, Number((Math.sin(angle + 0.85) * (radius + 1.2)).toFixed(2))],
        [Number((Math.cos(angle + 1.7) * Math.max(2.2, radius - 1.1)).toFixed(2)), 0.65, Number((Math.sin(angle + 1.7) * Math.max(2.2, radius - 1.1)).toFixed(2))],
      ],
      awarenessRadius: 3.4 + (index % 3) * 0.55,
      speed: 0.75 + (index % 4) * 0.08,
      health: 2,
    };
  });
}

function vecFromTuple(tuple: [number, number, number]) {
  return new Vec3(tuple[0], tuple[1], tuple[2]);
}

function makeMaterial(diffuseHex: string, emissiveHex: string) {
  const material = new StandardMaterial();
  material.diffuse = colorFromHex(diffuseHex);
  material.emissive = colorFromHex(emissiveHex);
  material.gloss = 0.42;
  material.metalness = 0.08;
  material.update();
  return material;
}

function colorFromHex(hex: string) {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return new Color(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  );
}

function isPreviewInputActive(canvas: HTMLCanvasElement) {
  const active = document.activeElement;
  return active === canvas || Boolean(active && canvas.closest('.preview-card')?.contains(active));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
