import {
  Asset,
  Application,
  BLEND_ADDITIVE,
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
  assets?: {
    humanoidUrl?: string;
    fallbackHumanoidUrl?: string;
    weaponStyle?: string;
    playerScale?: number;
    npcScale?: number;
  };
  combat?: {
    fireRate?: number;
    magazineSize?: number;
    reloadTime?: number;
    recoil?: number;
    hitRange?: number;
    hitRadius?: number;
    damage?: number;
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

const DEFAULT_HUMANOID_URL = '/assets/characters/CesiumMan.glb';
const FALLBACK_HUMANOID_URL = '/assets/characters/RiggedFigure.glb';

export function mountGamePreview(canvas: HTMLCanvasElement, state: PreviewState): GamePreviewRuntime {
  const app = new Application(canvas, {
    graphicsDeviceOptions: {
      alpha: true,
    },
  });
  let yaw = 0;
  let pitch = 0.14;
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
  let playerPitch = 0.14;
  let runtimeSpec: RuntimeSpec | undefined;
  let playerEntity: Entity | undefined;
  let objectiveEntity: Entity | undefined;
  let cameraEntity: Entity | undefined;
  let weaponEntity: Entity | undefined;
  let muzzleFlashEntity: Entity | undefined;
  let collisionEntity: Entity | undefined;
  let keyLightEntity: Entity | undefined;
  let fillLightEntity: Entity | undefined;
  let navmeshBytes = 0;
  let taggedEnemies = 0;
  let objectiveComplete = false;
  let fireCooldown = 0;
  let reloadTimer = 0;
  let reloading = false;
  let ammo = 24;
  let magazineSize = 24;
  let recoilKick = 0;
  let muzzleFlash = 0;
  const runtimeNpcs: Array<{
    spec: RuntimeNpc;
    entity: Entity;
    state: 'patrol' | 'chase' | 'tagged';
    routeIndex: number;
    baseY: number;
    phase: number;
    idleAnimationName?: string;
    walkAnimationName?: string;
    runAnimationName?: string;
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
    cameraEntity?.setPosition(playerPosition.x, playerPosition.y + 1.62, playerPosition.z);
    cameraEntity?.setEulerAngles((playerPitch * 180) / Math.PI, (playerYaw * 180) / Math.PI, 0);
    if (weaponEntity) {
      weaponEntity.setLocalPosition(0.26, -0.34 + recoilKick * 0.08, -0.72 - recoilKick * 0.22);
      weaponEntity.setLocalEulerAngles(-5 + recoilKick * 6, 1.6, 0);
    }
    if (muzzleFlashEntity) {
      muzzleFlashEntity.enabled = muzzleFlash > 0.05;
      muzzleFlashEntity.setLocalPosition(0.03, 0.02, -1.02);
      muzzleFlashEntity.setLocalScale(0.28 + muzzleFlash * 0.14, 0.28 + muzzleFlash * 0.14, 0.28 + muzzleFlash * 0.14);
    }
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
    pitch = clamp(pitch + dy * 0.004, -0.7, 0.86);
    previewPanX = clamp(previewPanX + dx * 0.22, -90, 90);
    previewPanY = clamp(previewPanY + dy * 0.18, -70, 70);
    playerYaw = yaw;
    playerPitch = pitch;
    updateCamera();
    updateFallbackPreview();
  };
  const pointerUp = (event: PointerEvent) => {
    if (dragging && pointerTravel < 5) {
      fireWeapon();
    }
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const nextFov = clamp((cameraEntity?.camera?.fov ?? 56) + event.deltaY * 0.015, 46, 68);
    if (cameraEntity?.camera) {
      cameraEntity.camera.fov = nextFov;
    }
    previewZoom = clamp(previewZoom - event.deltaY * 0.0012, 1, 1.28);
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
      fireWeapon();
    }

    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      startReload();
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

  cameraEntity = createCamera(app);
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

    playerEntity = new Entity('player-root');
    app.root.addChild(playerEntity);

    objectiveEntity = createPointLight('energy-core-beacon', 8.5, colorFromHex('#ffe67b'));
    objectiveEntity.setPosition(objectivePosition);
    app.root.addChild(objectiveEntity);

    keyLightEntity = createDirectionalLight('key-light', 2.8, colorFromHex('#dff9ff'), 34, 28);
    fillLightEntity = createDirectionalLight('fill-light', 1.15, colorFromHex('#7ebcff'), -22, -145);
    app.root.addChild(keyLightEntity);
    app.root.addChild(fillLightEntity);

    const weaponRig = createWeaponViewModel(materials);
    weaponEntity = weaponRig.root;
    muzzleFlashEntity = weaponRig.flash;
    cameraEntity?.addChild(weaponEntity);

    updateCamera();
    updateRuntimeHud('Playable runtime ready');
  }

  async function hydrateGeneratedRuntime() {
    runtimeSpec = await loadRuntimeSpec(state.runtimeUrl, state.npcArchetypes, state.objective);
    const spawn = runtimeSpec.player?.spawn ?? [0, 0.7, 7.8];
    playerPosition.set(spawn[0], spawn[1], spawn[2]);
    const objective = runtimeSpec.objective?.position ?? [0, 0.85, -3.2];
    objectivePosition.set(objective[0], objective[1], objective[2]);
    objectiveEntity?.setPosition(objectivePosition);

    ammo = runtimeSpec.player?.ammo ?? runtimeSpec.combat?.magazineSize ?? ammo;
    magazineSize = runtimeSpec.combat?.magazineSize ?? ammo;
    fireCooldown = 0;
    reloadTimer = 0;
    reloading = false;
    recoilKick = 0;
    muzzleFlash = 0;

    const humanoidAsset = await loadHumanoidAsset(
      runtimeSpec.assets?.humanoidUrl ?? DEFAULT_HUMANOID_URL,
      runtimeSpec.assets?.fallbackHumanoidUrl ?? FALLBACK_HUMANOID_URL,
    );

    spawnRuntimeNpcs(runtimeSpec.npcs ?? createFallbackNpcs(state.npcArchetypes), humanoidAsset, materials);
    await Promise.all([
      loadCollisionPreview(state.collisionUrl),
      loadNavmeshMetadata(state.navmeshUrl),
    ]);
    updateRuntimeHud('Runtime loaded from generated assets');
  }

  function spawnRuntimeNpcs(npcs: RuntimeNpc[], humanoidAsset: Asset | undefined, runtimeMaterials: ReturnType<typeof createRuntimeMaterials>) {
    runtimeNpcs.splice(0).forEach((npc) => npc.entity.destroy());
    npcs.slice(0, 8).forEach((npc, index) => {
      const spawn = npc.spawn ?? [Math.cos(index) * 4, 0.65, Math.sin(index) * 4];
      const entity = humanoidAsset
        ? instantiateHumanoidEntity(humanoidAsset, npc.id || `npc-${index + 1}`, runtimeSpec?.assets?.npcScale ?? 1)
        : createRuntimeEntity(npc.id || `npc-${index + 1}`, 'capsule', runtimeMaterials.npc);
      const isHumanoid = Boolean(humanoidAsset);
      entity.setPosition(spawn[0], isHumanoid ? Math.max(0, spawn[1] - 0.65) : spawn[1], spawn[2]);
      if (!isHumanoid) {
        entity.setLocalScale(0.34, 0.72, 0.34);
      }
      app.root.addChild(entity);
      const runtimeNpc = {
        spec: npc,
        entity,
        state: 'patrol' as const,
        routeIndex: 0,
        baseY: isHumanoid ? Math.max(0, spawn[1] - 0.65) : spawn[1],
        phase: index * 0.7,
        idleAnimationName: pickAnimationName(entity, ['idle', 'breath', 'stand']),
        walkAnimationName: pickAnimationName(entity, ['walk', 'move', 'locomotion']),
        runAnimationName: pickAnimationName(entity, ['run', 'sprint', 'walk']),
      };
      runtimeNpcs.push(runtimeNpc);
      setNpcAnimation(runtimeNpc, 'patrol');
    });
  }

  function updateRuntime(dt: number) {
    const combat = runtimeSpec?.combat;
    if (fireCooldown > 0) {
      fireCooldown = Math.max(0, fireCooldown - dt);
    }
    if (reloading) {
      reloadTimer = Math.max(0, reloadTimer - dt);
      if (reloadTimer === 0) {
        reloading = false;
        ammo = magazineSize;
        updateRuntimeHud('Reload complete');
      }
    }
    recoilKick = Math.max(0, recoilKick - dt * 6.2);
    muzzleFlash = Math.max(0, muzzleFlash - dt * 12);

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
    }

    runtimeNpcs.forEach((npc) => updateNpc(npc, dt));
    objectiveEntity?.rotate(0, 55 * dt, 0);
    playerEntity?.setPosition(playerPosition);
    playerEntity?.setEulerAngles(0, (playerYaw * 180) / Math.PI, 0);
    const objectiveRadius = runtimeSpec?.objective?.radius ?? 1.6;
    const requiredTags = runtimeSpec?.objective?.requiredTags ?? 3;
    objectiveComplete = taggedEnemies >= requiredTags && playerPosition.distance(objectivePosition) <= objectiveRadius;
    if (objectiveComplete) {
      updateRuntimeHud('Objective complete');
    } else if (combat && reloading) {
      updateRuntimeHud('Reloading');
    }
  }

  function updateNpc(npc: (typeof runtimeNpcs)[number], dt: number) {
    npc.phase += dt;
    if (npc.state === 'tagged') {
      npc.entity.rotate(0, 80 * dt, 0);
      const taggedPosition = npc.entity.getPosition();
      npc.entity.setPosition(taggedPosition.x, npc.baseY + Math.sin(npc.phase * 7) * 0.04, taggedPosition.z);
      return;
    }

    const npcPosition = npc.entity.getPosition();
    const awareness = npc.spec.awarenessRadius ?? 3.5;
    const nextState = npcPosition.distance(playerPosition) < awareness ? 'chase' : 'patrol';
    if (nextState !== npc.state) {
      npc.state = nextState;
      setNpcAnimation(npc, nextState);
    }
    const target = npc.state === 'chase'
      ? playerPosition
      : vecFromTuple(npc.spec.route?.[npc.routeIndex] ?? npc.spec.spawn ?? [0, 0.65, 0]);
    const direction = target.clone().sub(npcPosition);
    const distanceToTarget = direction.length();
    if (distanceToTarget > 0.05) {
      direction.normalize();
      const npcSpeed = (npc.spec.speed ?? 0.8) * (npc.state === 'chase' ? 1.45 : 1);
      const nextPosition = npcPosition.add(direction.mulScalar(npcSpeed * dt));
      const bob = Math.sin(npc.phase * (npc.state === 'chase' ? 9 : 6)) * 0.035;
      npc.entity.setPosition(nextPosition.x, npc.baseY + bob, nextPosition.z);
      npc.entity.lookAt(new Vec3(target.x, npcPosition.y, target.z));
    } else if (npc.state === 'patrol') {
      npc.routeIndex = (npc.routeIndex + 1) % Math.max(1, npc.spec.route?.length ?? 1);
    }
  }

  function fireWeapon() {
    if (reloading || fireCooldown > 0) {
      return;
    }

    if (ammo <= 0) {
      startReload();
      return;
    }

    const combat = runtimeSpec?.combat;
    ammo -= 1;
    fireCooldown = 1 / Math.max(1, combat?.fireRate ?? 7.5);
    recoilKick = 1;
    muzzleFlash = 1;

    const hit = traceShot(combat?.hitRange ?? 14, combat?.hitRadius ?? 0.9);
    if (hit) {
      hit.npc.state = 'tagged';
      setNpcAnimation(hit.npc, 'tagged');
      taggedEnemies += 1;
      updateRuntimeHud(`Hit ${hit.npc.spec.name}`);
    } else {
      updateRuntimeHud('Shot fired');
    }

    if (ammo <= 0) {
      startReload();
    }
  }

  function startReload() {
    if (reloading || ammo >= magazineSize) {
      return;
    }

    reloading = true;
    reloadTimer = runtimeSpec?.combat?.reloadTime ?? 1.7;
    updateRuntimeHud('Reloading');
  }

  function traceShot(hitRange: number, hitRadius: number) {
    const origin = new Vec3(playerPosition.x, playerPosition.y + 1.62, playerPosition.z);
    const direction = getCameraForward();
    const alive = runtimeNpcs.filter((npc) => npc.state !== 'tagged');
    let closest: { npc: (typeof runtimeNpcs)[number]; distance: number } | undefined;

    for (const npc of alive) {
      const target = npc.entity.getPosition();
      const toTarget = target.clone().sub(origin);
      const forward = toTarget.dot(direction);
      if (forward < 0 || forward > hitRange) {
        continue;
      }

      const projected = origin.clone().add(direction.clone().mulScalar(forward));
      const lateral = target.distance(projected);
      if (lateral <= hitRadius && (!closest || forward < closest.distance)) {
        closest = {
          npc,
          distance: forward,
        };
      }
    }

    return closest;
  }

  function getCameraForward() {
    const cosPitch = Math.cos(playerPitch);
    return new Vec3(
      Math.sin(playerYaw) * cosPitch,
      Math.sin(playerPitch),
      Math.cos(playerYaw) * cosPitch,
    ).normalize();
  }

  function setNpcAnimation(npc: (typeof runtimeNpcs)[number], state: 'patrol' | 'chase' | 'tagged') {
    const animation = npc.entity.animation;
    if (!animation || !Object.keys(animation.animations || {}).length) {
      return;
    }

    const nextAnimation = state === 'tagged'
      ? npc.runAnimationName || npc.walkAnimationName || npc.idleAnimationName
      : state === 'chase'
        ? npc.runAnimationName || npc.walkAnimationName || npc.idleAnimationName
        : npc.walkAnimationName || npc.idleAnimationName || npc.runAnimationName;

    if (nextAnimation) {
      animation.play(nextAnimation);
    }
  }

  function pickAnimationName(entity: Entity, keywords: string[]) {
    const animation = entity.animation;
    if (!animation) {
      return undefined;
    }

    const names = Object.keys(animation.animations || {});
    if (!names.length) {
      return undefined;
    }

    return pickByKeywords(names, keywords) || names[0];
  }

  function pickByKeywords(names: string[], keywords: string[]) {
    const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
    return names.find((name) => loweredKeywords.some((keyword) => name.toLowerCase().includes(keyword)));
  }

  function updateRuntimeHud(message?: string) {
    if (runtimeStatus && message) {
      runtimeStatus.textContent = `${message} · WASD move · mouse look · click or space fire · R reload`;
    }
    if (runtimeObjective) {
      runtimeObjective.textContent = runtimeSpec?.objective?.title || state.objective || 'Reach the energy core';
    }
    if (runtimeEnemies) {
      const remaining = runtimeNpcs.filter((npc) => npc.state !== 'tagged').length;
      runtimeEnemies.textContent = `${remaining}/${runtimeNpcs.length || 8} patrols active · ammo ${ammo}/${magazineSize} · nav ${navmeshBytes ? `${Math.round(navmeshBytes / 1024)}KB` : 'pending'}`;
    }
  }

  function createRuntimeEntity(name: string, type: 'capsule' | 'sphere' | 'box' | 'cylinder', material: StandardMaterial) {
    const entity = new Entity(name);
    entity.addComponent('render', {
      type,
      material,
    });
    return entity;
  }

  function createDirectionalLight(name: string, intensity: number, color: Color, pitchDegrees: number, yawDegrees: number) {
    const entity = new Entity(name);
    entity.addComponent('light', {
      type: 'directional',
      color,
      intensity,
      castShadows: true,
    });
    entity.setEulerAngles(pitchDegrees, yawDegrees, 0);
    return entity;
  }

  function createPointLight(name: string, intensity: number, color: Color) {
    const entity = new Entity(name);
    entity.addComponent('light', {
      type: 'point',
      color,
      intensity,
      range: 7,
      castShadows: false,
    });
    return entity;
  }

  function createWeaponViewModel(runtimeMaterials: ReturnType<typeof createRuntimeMaterials>) {
    const root = new Entity('weapon-viewmodel');
    const receiver = createRuntimeEntity('weapon-receiver', 'box', runtimeMaterials.weapon);
    receiver.setLocalScale(0.3, 0.17, 0.56);
    receiver.setLocalPosition(0.02, 0.02, -0.08);

    const barrel = createRuntimeEntity('weapon-barrel', 'cylinder', runtimeMaterials.weaponBarrel);
    barrel.setLocalScale(0.045, 0.045, 0.82);
    barrel.setLocalPosition(0, 0.06, -0.82);
    barrel.setLocalEulerAngles(90, 0, 0);

    const stock = createRuntimeEntity('weapon-stock', 'box', runtimeMaterials.weapon);
    stock.setLocalScale(0.22, 0.12, 0.38);
    stock.setLocalPosition(-0.22, 0.03, 0.1);
    stock.setLocalEulerAngles(0, -12, -5);

    const grip = createRuntimeEntity('weapon-grip', 'box', runtimeMaterials.weaponGrip);
    grip.setLocalScale(0.09, 0.18, 0.14);
    grip.setLocalPosition(-0.01, -0.14, -0.02);
    grip.setLocalEulerAngles(14, 0, 0);

    const magazine = createRuntimeEntity('weapon-magazine', 'box', runtimeMaterials.weaponMag);
    magazine.setLocalScale(0.08, 0.21, 0.15);
    magazine.setLocalPosition(0.04, -0.12, -0.04);
    magazine.setLocalEulerAngles(8, 0, 0);

    const sight = createRuntimeEntity('weapon-sight', 'box', runtimeMaterials.weaponAccent);
    sight.setLocalScale(0.07, 0.05, 0.14);
    sight.setLocalPosition(0.02, 0.12, 0.12);

    const handGuard = createRuntimeEntity('weapon-handguard', 'box', runtimeMaterials.weaponBarrel);
    handGuard.setLocalScale(0.16, 0.09, 0.38);
    handGuard.setLocalPosition(0.04, 0.01, -0.46);

    const trigger = createRuntimeEntity('weapon-trigger', 'box', runtimeMaterials.weaponAccent);
    trigger.setLocalScale(0.04, 0.06, 0.05);
    trigger.setLocalPosition(-0.01, -0.07, -0.02);

    const flash = createRuntimeEntity('muzzle-flash', 'sphere', runtimeMaterials.flash);
    flash.setLocalScale(0.28, 0.28, 0.28);
    flash.setLocalPosition(0.02, 0.06, -1.02);
    flash.enabled = false;

    root.addChild(receiver);
    root.addChild(barrel);
    root.addChild(stock);
    root.addChild(grip);
    root.addChild(magazine);
    root.addChild(sight);
    root.addChild(handGuard);
    root.addChild(trigger);
    root.addChild(flash);
    root.setLocalPosition(0.26, -0.34, -0.72);
    root.setLocalEulerAngles(-5, 1.6, 0);

    return {
      root,
      flash,
    };
  }

  async function loadHumanoidAsset(url: string, fallbackUrl: string) {
    const candidates = [url, fallbackUrl].filter(Boolean);
    for (const candidate of candidates) {
      const asset = await loadContainerAsset(candidate, 'humanoid');
      if (asset) {
        return asset;
      }
    }

    return undefined;
  }

  async function loadContainerAsset(url: string, label: string) {
    const asset = new Asset(`${label}-${Date.now()}`, 'container', { url });
    app.assets.add(asset);
    return await new Promise<Asset | undefined>((resolve) => {
      asset.ready(() => resolve(asset));
      asset.on('error', () => {
        app.assets.remove(asset);
        resolve(undefined);
      });
      app.assets.load(asset);
    });
  }

  function instantiateHumanoidEntity(asset: Asset, name: string, scale = 1) {
    const resource = asset.resource as {
      instantiateModelEntity?: (options?: object) => Entity;
    };
    const entity = resource.instantiateModelEntity?.({
      castShadows: true,
      receiveShadows: true,
    }) || createRuntimeEntity(name, 'capsule', materials.npc);
    entity.name = name;
    entity.setLocalScale(scale, scale, scale);
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
      weapon: makeMaterial('#26313d', '#0e1922'),
      weaponBarrel: makeMaterial('#101821', '#0a1119'),
      weaponGrip: makeMaterial('#1f2b35', '#0b151d'),
      weaponMag: makeMaterial('#33414d', '#111b24'),
      weaponAccent: makeMaterial('#7ea7ba', '#253a48'),
      flash: makeFlashMaterial(),
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
    assets: {
      humanoidUrl: DEFAULT_HUMANOID_URL,
      fallbackHumanoidUrl: FALLBACK_HUMANOID_URL,
      weaponStyle: 'procedural-fps-rifle',
      playerScale: 1,
      npcScale: 1,
    },
    combat: {
      fireRate: 7.8,
      magazineSize: 24,
      reloadTime: 1.7,
      recoil: 0.23,
      hitRange: 14,
      hitRadius: 0.9,
      damage: 25,
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

function makeFlashMaterial() {
  const material = new StandardMaterial();
  material.diffuse = colorFromHex('#fff4ba');
  material.emissive = colorFromHex('#ffb33d');
  material.opacity = 0.86;
  material.blendType = BLEND_ADDITIVE;
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
