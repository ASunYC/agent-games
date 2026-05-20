import {
  Asset,
  Application,
  Color,
  Entity,
  FILLMODE_NONE,
  RESOLUTION_AUTO,
  Vec3,
} from 'playcanvas';

export type PreviewState = {
  status: 'draft' | 'generated' | 'published';
  modelName: string;
  sceneLabel: string;
  modelUrl?: string;
  fallbackModelUrl?: string;
  flipVertical?: boolean;
  collisionUrl?: string;
  navmeshUrl?: string;
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
  let previewPanX = 0;
  let previewPanY = 0;
  let previewZoom = 1.06;
  const previewSurface = canvas.closest<HTMLElement>('.preview-card');
  const previewStatus = previewSurface?.querySelector<HTMLElement>('[data-preview-status]');
  previewSurface?.classList.add('is-loading');
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
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    yaw -= dx * 0.006;
    pitch = clamp(pitch + dy * 0.004, -0.18, 1.15);
    previewPanX = clamp(previewPanX + dx * 0.22, -90, 90);
    previewPanY = clamp(previewPanY + dy * 0.18, -70, 70);
    updateCamera();
    updateFallbackPreview();
  };
  const pointerUp = (event: PointerEvent) => {
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

  app.setCanvasFillMode(FILLMODE_NONE);
  app.setCanvasResolution(RESOLUTION_AUTO);
  app.scene.ambientLight = new Color(0.34, 0.38, 0.36);

  resize();
  updateFallbackPreview();
  window.addEventListener('resize', resize);

  const camera = createCamera(app);
  updateCamera();

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

  app.on('update', () => {
    updateCamera();
  });

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });
  app.start();

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('wheel', wheel);
      previewSurface?.classList.remove('is-loading', 'is-live');
      app.destroy();
    },
  };
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
