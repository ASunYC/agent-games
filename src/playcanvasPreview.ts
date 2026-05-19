import {
  Application,
  Color,
  Entity,
  FILLMODE_NONE,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
} from 'playcanvas';

export type PreviewState = {
  status: 'draft' | 'generated' | 'published';
  modelName: string;
  versionCount: number;
  mechanics: string[];
  generationStep?: number;
};

export type GamePreviewRuntime = {
  destroy: () => void;
};

type PreviewEntity = {
  entity: Entity;
  home: Vec3;
};

export function mountGamePreview(canvas: HTMLCanvasElement, state: PreviewState): GamePreviewRuntime {
  const app = new Application(canvas);
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    app.resizeCanvas(Math.max(1, Math.floor(bounds.width)), Math.max(1, Math.floor(bounds.height)));
  };

  app.setCanvasFillMode(FILLMODE_NONE);
  app.setCanvasResolution(RESOLUTION_AUTO);
  app.scene.ambientLight = new Color(0.34, 0.38, 0.36);

  resize();
  window.addEventListener('resize', resize);

  const materials = createMaterials();
  const step = state.generationStep ?? 0;
  const player = createPlayer(app, materials.player);
  const camera = createCamera(app);
  const enemies = createEnemies(app, materials.enemy, state.status !== 'draft' || step >= 5);

  createGeneratedLevel(app, materials, step);
  createLighting(app);
  createObjective(app, materials.objective, state.status !== 'draft' || step >= 4);
  camera.lookAt(player.getPosition());

  app.on('update', (dt) => {
    const t = performance.now() * 0.001;
    const radius = 9;
    camera.setPosition(Math.sin(t * 0.18) * radius, 5.1, Math.cos(t * 0.18) * radius + 2);
    camera.lookAt(0, 1.2, 0);
    player.setEulerAngles(0, Math.sin(t * 0.8) * 7, 0);

    enemies.forEach((item, index) => {
      const phase = t * (0.55 + index * 0.04) + index;
      item.entity.setPosition(
        item.home.x + Math.sin(phase) * 0.28,
        item.home.y + Math.sin(phase * 2) * 0.05,
        item.home.z + Math.cos(phase) * 0.28,
      );
      item.entity.rotate(0, 36 * dt, 0);
    });
  });

  app.start();

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      app.destroy();
    },
  };
}

function createMaterials() {
  return {
    floor: material('#253238'),
    splat: material('#5f7058'),
    wall: material('#303b3f'),
    player: material('#dfe7ea'),
    enemy: material('#d6e36a'),
    objective: material('#f0b35a'),
  };
}

function material(hex: string) {
  const mat = new StandardMaterial();
  const color = colorFromHex(hex);
  mat.diffuse = color;
  mat.emissive = color;
  mat.emissiveIntensity = 0.08;
  mat.update();
  return mat;
}

function colorFromHex(hex: string) {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  return new Color(red, green, blue);
}

function createGeneratedLevel(
  app: Application,
  materials: ReturnType<typeof createMaterials>,
  step: number,
) {
  createBox(app, 'collision-floor', materials.floor, [0, -0.08, 0], [14, 0.16, 18]);

  if (step >= 1) {
    createBox(app, 'splat-loaded-volume-a', materials.splat, [-2.8, 1.1, -1.2], [3.8, 2.2, 5.8]);
    createBox(app, 'splat-loaded-volume-b', materials.splat, [2.8, 0.8, -2.2], [3.2, 1.6, 4.2]);
  }

  if (step >= 2) {
    createBox(app, 'collision-wall-a', materials.wall, [-4.8, 1.1, -1.2], [1.2, 2.2, 7.5]);
    createBox(app, 'collision-wall-b', materials.wall, [3.8, 1, -2.5], [1.1, 2, 5]);
    createBox(app, 'collision-wall-c', materials.wall, [0.4, 1.4, 4.3], [6.4, 2.8, 1]);
  }

  const splatCount = step >= 1 ? 34 : 10;
  for (let i = 0; i < splatCount; i += 1) {
    const x = Math.sin(i * 1.93) * 5.6;
    const z = Math.cos(i * 1.31) * 7.2;
    const y = 0.15 + ((i * 13) % 17) * 0.015;
    const scale = 0.06 + ((i * 5) % 11) * 0.015;
    createSphere(app, `splat-point-${i}`, materials.splat, [x, y, z], [scale, scale, scale]);
  }
}

function createPlayer(app: Application, materialRef: StandardMaterial) {
  const player = createBox(app, 'fps-player-rig', materialRef, [0, 0.75, 5.2], [0.45, 1.5, 0.45]);
  createBox(app, 'weapon-proxy', materialRef, [0.42, 0.65, 4.72], [0.18, 0.18, 0.8]);
  return player;
}

function createCamera(app: Application) {
  const camera = new Entity('preview-camera');
  camera.addComponent('camera', {
    clearColor: new Color(0.04, 0.07, 0.09),
    fov: 54,
    nearClip: 0.1,
    farClip: 120,
  });
  app.root.addChild(camera);
  camera.setPosition(0, 4.8, 11);
  return camera;
}

function createLighting(app: Application) {
  const sun = new Entity('probe-key-light');
  sun.addComponent('light', {
    type: 'directional',
    color: new Color(0.92, 0.95, 0.9),
    intensity: 1.4,
  });
  sun.setEulerAngles(48, 36, 0);
  app.root.addChild(sun);

  const fill = new Entity('probe-fill-light');
  fill.addComponent('light', {
    type: 'omni',
    color: new Color(0.45, 0.62, 0.62),
    intensity: 0.7,
    range: 18,
  });
  fill.setPosition(0, 3, 2);
  app.root.addChild(fill);
}

function createEnemies(app: Application, materialRef: StandardMaterial, visible: boolean) {
  const enemies: PreviewEntity[] = [];

  if (!visible) {
    return enemies;
  }

  for (let i = 0; i < 8; i += 1) {
    const x = -4.3 + (i % 4) * 2.8;
    const z = -4.8 + Math.floor(i / 4) * 3.4;
    const entity = createCapsule(app, `navmesh-npc-${i + 1}`, materialRef, [x, 0.72, z], [0.34, 0.72, 0.34]);
    enemies.push({ entity, home: new Vec3(x, 0.72, z) });
  }

  return enemies;
}

function createObjective(app: Application, materialRef: StandardMaterial, visible: boolean) {
  if (!visible) {
    return;
  }

  const core = createSphere(app, 'energy-core-objective', materialRef, [0, 1.15, -5.7], [0.36, 0.36, 0.36]);
  core.addComponent('light', {
    type: 'omni',
    color: new Color(0.95, 0.62, 0.26),
    intensity: 1.8,
    range: 5,
  });
}

function createBox(
  app: Application,
  name: string,
  materialRef: StandardMaterial,
  position: [number, number, number],
  scale: [number, number, number],
) {
  const entity = new Entity(name);
  entity.addComponent('render', {
    type: 'box',
    material: materialRef,
  });
  entity.setPosition(...position);
  entity.setLocalScale(...scale);
  app.root.addChild(entity);
  return entity;
}

function createSphere(
  app: Application,
  name: string,
  materialRef: StandardMaterial,
  position: [number, number, number],
  scale: [number, number, number],
) {
  const entity = new Entity(name);
  entity.addComponent('render', {
    type: 'sphere',
    material: materialRef,
  });
  entity.setPosition(...position);
  entity.setLocalScale(...scale);
  app.root.addChild(entity);
  return entity;
}

function createCapsule(
  app: Application,
  name: string,
  materialRef: StandardMaterial,
  position: [number, number, number],
  scale: [number, number, number],
) {
  const entity = new Entity(name);
  entity.addComponent('render', {
    type: 'capsule',
    material: materialRef,
  });
  entity.setPosition(...position);
  entity.setLocalScale(...scale);
  app.root.addChild(entity);
  return entity;
}
