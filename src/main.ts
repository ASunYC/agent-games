import './style.css';
import type { GamePreviewRuntime } from './playcanvasPreview';

type ProjectStatus = 'draft' | 'generated' | 'published';
type AppView = 'home' | 'studio';

type Project = {
  id: string;
  name: string;
  prompt: string;
  modelName: string;
  modelUrl?: string;
  modelSource?: 'uploaded' | 'builtin';
  status: ProjectStatus;
  updatedAt: string;
  versions: GameVersion[];
  publishedUrl?: string;
};

type GameVersion = {
  id: string;
  title: string;
  summary: string;
  mechanics: string[];
  shareUrl: string;
  createdAt: string;
  sourceUrl?: string;
  streamedUrl?: string;
  collisionUrl?: string;
  navmeshUrl?: string;
  runtimeUrl?: string;
  behaviorTreeUrl?: string;
  snapshotUrl?: string;
  publishUrl?: string;
  workspacePath?: string;
  npcArchetypes?: Array<{ name: string; role: string; behavior: string }>;
  objective?: string;
  publishTag?: string;
};

type ShowcaseGame = {
  title: string;
  creator: string;
  plays: string;
  style: string;
};

type GenerationStep = {
  label: string;
  detail: string;
};

type WorkspaceProjectRecord = {
  id: string;
  name: string;
  prompt: string;
  modelName: string;
  modelUrl?: string;
  modelSource?: 'uploaded' | 'builtin';
  status: ProjectStatus;
  updatedAt: string;
  runs?: GameVersion[];
  publishedUrl?: string;
};

type WorkspaceGenerationPlan = {
  title: string;
  summary: string;
  mechanics: string[];
  npcArchetypes: Array<{ name: string; role: string; behavior: string }>;
  objective: string;
  publishTag: string;
  snapshotCaption: string;
};

type WorkspaceGenerationResult = {
  project: WorkspaceProjectRecord;
  version: GameVersion;
  plan: WorkspaceGenerationPlan;
};

type WorkspacePublishResult = {
  project: WorkspaceProjectRecord;
  version: GameVersion;
};

const storageKey = 'agent-games-projects';
const builtInTestScene = {
  id: '96fe38b6',
  name: '96fe38b6.ply',
  sourceUrl: '/data/96fe38b6/96fe38b6.ply',
  streamedUrl: '/data/96fe38b6/96fe38b6.sog',
  previewUrl: '/data/96fe38b6/preview/meta.json',
  collisionUrl: '/data/96fe38b6/96fe38b6.collision.glb',
  voxelUrl: '/data/96fe38b6/96fe38b6.voxel.json',
  navmeshUrl: '/data/96fe38b6/navmesh.bin',
  path: 'data/96fe38b6/96fe38b6.ply',
  previewPath: 'data/96fe38b6/preview/meta.json',
  streamedPath: 'data/96fe38b6/96fe38b6.sog',
  collisionPath: 'data/96fe38b6/96fe38b6.collision.glb',
  navmeshPath: 'data/96fe38b6/navmesh.bin',
};
const defaultPrompt =
  'Turn my abandoned building Gaussian splat into a browser FPS with exploration, collision, a navmesh, eight AI enemies, an energy-core objective, and a share link.';

const generationSteps: GenerationStep[] = [
  {
    label: 'Read prompt',
    detail: 'Extract game genre, objective, camera, win condition, and asset requirements.',
  },
  {
    label: 'Select source splat',
    detail: 'Use the uploaded PLY/SOG or the built-in 96fe38b6.ply test scan as the input.',
  },
  {
    label: 'Run splat-transform',
    detail: 'Convert the source scan into a Streamed SOG bundle and emit collision assets.',
  },
  {
    label: 'Stream SOG scene',
    detail: 'Load the generated SOG in PlayCanvas as the visible Gaussian world.',
  },
  {
    label: 'Attach collision GLB',
    detail: 'Use the generated collision GLB as static rigid bodies for floors, walls, and blockers.',
  },
  {
    label: 'Bake Recast navmesh',
    detail: 'Feed the collision GLB into Recast to create navmesh.bin for AI pathfinding.',
  },
  {
    label: 'Generate gameplay',
    detail: 'Add FPS controls, mission rules, pickups, weapon logic, and UI states.',
  },
  {
    label: 'Spawn NPCs',
    detail: 'Place AI enemies, patrol routes, awareness states, and encounter pacing.',
  },
  {
    label: 'Publish build',
    detail: 'Package the game into a shareable browser build for launch and iteration.',
  },
];

const playersChoice: ShowcaseGame[] = [
  { title: 'Splat Spark', creator: 'Keplerforge', plays: '1.0M', style: 'cover-rose' },
  { title: 'Mini Siege', creator: 'KibblezGamez', plays: '1.4M', style: 'cover-amber' },
  { title: 'Sortie Lab', creator: 'nudo', plays: '4.8M', style: 'cover-sky' },
  { title: 'Space Race', creator: 'blackwidowink', plays: '533.4K', style: 'cover-cobalt' },
  { title: 'Park Pal', creator: 'dawn', plays: '5.9M', style: 'cover-mint' },
  { title: 'Apex Predator', creator: 'nuvu', plays: '996.7K', style: 'cover-jungle' },
  { title: '99 Nights', creator: 'SkulHunter', plays: '1.4M', style: 'cover-night' },
];

const trending: ShowcaseGame[] = [
  { title: 'Brawl Buddies', creator: 'kenkenfodj', plays: '4.2K', style: 'cover-comic' },
  { title: 'Cube World', creator: 'echoxiaoxi', plays: '17.9K', style: 'cover-blocks' },
  { title: 'Rolling Rush', creator: 'lsk', plays: '5.4K', style: 'cover-roll' },
  { title: 'Color Splash', creator: 'tamporef', plays: '18.2K', style: 'cover-paper' },
  { title: 'Fish Evolve', creator: 'chengqb', plays: '2.9K', style: 'cover-reef' },
  { title: 'Astroman', creator: 'Djam', plays: '7.2M', style: 'cover-hero' },
  { title: 'Trail Ride', creator: 'slaytaria', plays: '685', style: 'cover-trail' },
  { title: 'Energy Jump', creator: 'Amos', plays: '22.7K', style: 'cover-energy' },
  { title: 'Ant Colony', creator: 'Sidman147', plays: '9.3K', style: 'cover-colony' },
];

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App mount point not found.');
}

const appRoot = app;
let projects = loadProjects();
let activeProjectId = projects[0]?.id ?? createSeedProject().id;
let uploadedModelName = getActiveProject().modelSource === 'uploaded' ? getActiveProject().modelName : '';
let uploadedModelUrl = getActiveProject().modelSource === 'uploaded' ? getActiveProject().modelUrl || '' : '';
let previewRuntime: GamePreviewRuntime | undefined;
let previewMountId = 0;
let generationState: 'idle' | 'working' | 'ready' = 'idle';
let currentView: AppView = window.location.hash === '#create' ? 'studio' : 'home';
let activeGenerationStep = 0;
let generationTimers: number[] = [];
let pendingUploadPromise: Promise<void> | undefined;
let generationToken = 0;
let previewFullscreen = false;

render();

function loadProjects(): Project[] {
  const raw = window.localStorage.getItem(storageKey);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Project[];
    return parsed.map((project) => ({
      ...project,
      versions: shouldResetBuiltinProject(project)
        ? []
        : Array.isArray(project.versions)
          ? project.versions.map((version) => normalizeVersion(version))
          : [],
      modelName: isBuiltInSceneProject(project) ? builtInTestScene.name : project.modelName,
      modelSource: isBuiltInSceneProject(project) ? 'builtin' : project.modelSource,
      modelUrl: project.modelUrl?.startsWith('blob:')
        ? ''
        : shouldResetBuiltinProject(project)
          ? builtInTestScene.sourceUrl
          : project.modelUrl,
    }));
  } catch {
    return [];
  }
}

function isBuiltInSceneProject(project: Project) {
  return (
    project.modelName === builtInTestScene.name ||
    project.modelName === '23ebe85c.ply' ||
    Boolean(project.modelUrl?.includes('/data/96fe38b6/')) ||
    Boolean(project.modelUrl?.includes('/data/23ebe85c/'))
  );
}

function shouldResetBuiltinProject(project: Project) {
  if (project.modelSource !== 'builtin') {
    return false;
  }

  if (
    project.modelName === '23ebe85c.ply' ||
    Boolean(project.modelUrl?.includes('/data/23ebe85c/'))
  ) {
    return true;
  }

  if (!Array.isArray(project.versions) || project.versions.length === 0) {
    return false;
  }

  const hasLegacyAsset = project.versions.some((version) => {
    const values = [
      version.sourceUrl,
      version.streamedUrl,
      version.collisionUrl,
      version.navmeshUrl,
      version.runtimeUrl,
      version.behaviorTreeUrl,
      version.snapshotUrl,
      version.publishUrl,
      version.workspacePath,
    ];

    return values.some((value) => Boolean(value?.includes('/data/23ebe85c/') || value?.includes('23ebe85c')));
  });

  if (hasLegacyAsset) {
    return true;
  }

  return !project.versions.some((version) => {
    const values = [
      version.sourceUrl,
      version.streamedUrl,
      version.collisionUrl,
      version.navmeshUrl,
      version.runtimeUrl,
      version.behaviorTreeUrl,
      version.snapshotUrl,
      version.publishUrl,
      version.workspacePath,
    ];

    return values.some((value) => Boolean(value?.includes(builtInTestScene.id)));
  });
}

function saveProjects() {
  window.localStorage.setItem(storageKey, JSON.stringify(projects));
}

function createSeedProject(): Project {
  const project: Project = {
    id: crypto.randomUUID(),
    name: 'Abandoned Splat FPS',
    prompt: defaultPrompt,
    modelName: '',
    modelUrl: '',
    modelSource: undefined,
    status: 'draft',
    updatedAt: new Date().toISOString(),
    versions: [],
  };

  projects = [project];
  saveProjects();
  return project;
}

function getActiveProject() {
  const project = projects.find((item) => item.id === activeProjectId);

  if (!project) {
    throw new Error('Active project not found.');
  }

  return project;
}

function render() {
  const project = getActiveProject();
  const latestVersion = project.versions[0];
  const mechanics = latestVersion?.mechanics ?? defaultMechanics();
  const generatedShelf = projects.filter((item) => item.versions.length > 0);
  const mountId = (previewMountId += 1);

  previewRuntime?.destroy();
  previewRuntime = undefined;

  appRoot.innerHTML = `
    <div class="app-frame">
      <aside class="sidebar">
        <a class="brand" href="#home" aria-label="Agent Games home">
          <span class="brand-mark">${starIcon()}</span>
          <span>Agent Games</span>
        </a>
        <button class="play-button" data-action="play-latest">${playIcon()} Play</button>
        <nav class="nav-list" aria-label="Primary navigation">
          ${navItem('Home', homeIcon(), currentView === 'home', 'home')}
          ${navItem('Create', plusIcon(), currentView === 'studio', 'studio')}
          ${navItem('Profile', userIcon(), false)}
          ${navItem('Sign In', loginIcon(), false)}
          ${navItem('More', gridIcon(), false)}
        </nav>
        <div class="sidebar-foot">
          <span>DISCORD</span>
          <span>X</span>
          <span>IG</span>
          <span>TIKTOK</span>
        </div>
      </aside>

      <main class="content" id="home">
        <div class="content-inner">
          ${
            currentView === 'home'
              ? homeView(generatedShelf)
              : studioView(project, latestVersion, mechanics)
          }
        </div>
      </main>
    </div>
  `;

  bindEvents();
  const canvas = document.querySelector<HTMLCanvasElement>('#preview-canvas');

  if (canvas) {
    const sceneAssets = resolveSceneAssets(project, latestVersion, generationState);
    const previewState = {
      status: project.status,
      modelName: project.modelName,
      sceneLabel: sceneSourceLabel(project),
      modelUrl: sceneAssets.streamedUrl,
      fallbackModelUrl: sceneAssets.fallbackUrl,
      flipVertical: sceneAssets.flipVertical,
      collisionUrl: sceneAssets.collisionUrl,
      navmeshUrl: sceneAssets.navmeshUrl,
      runtimeUrl: latestVersion?.runtimeUrl,
      behaviorTreeUrl: latestVersion?.behaviorTreeUrl,
      npcArchetypes: latestVersion?.npcArchetypes ?? [],
      objective: latestVersion?.objective,
      versionCount: project.versions.length,
      mechanics,
      generationStep:
        generationState === 'working'
          ? activeGenerationStep
          : project.status === 'draft'
            ? 0
            : generationSteps.length,
    };

    void import('./playcanvasPreview').then(({ mountGamePreview }) => {
      if (mountId !== previewMountId || !canvas.isConnected) {
        return;
      }

      previewRuntime = mountGamePreview(canvas, previewState);
    });
  }
}

function bindEvents() {
  document.querySelector<HTMLFormElement>('#creator-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = document.querySelector<HTMLTextAreaElement>('#prompt-input')?.value.trim() || defaultPrompt;
    startGeneration(prompt);
  });

  document.querySelector('#model-upload')?.addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file) {
      return;
    }

    const project = getActiveProject();
    uploadedModelName = file.name;
    project.modelName = file.name;
    project.modelSource = 'uploaded';
    project.updatedAt = new Date().toISOString();
    currentView = 'studio';
    saveProjects();
    const uploadPromise = uploadProjectAsset(project.id, file).then((result) => {
      const active = getActiveProject();
      active.modelName = result.project.modelName;
      active.modelUrl = result.project.modelUrl;
      active.modelSource = result.project.modelSource;
      active.updatedAt = result.project.updatedAt;
      saveProjects();
    }).catch((error) => {
      console.error(error);
    });
    pendingUploadPromise = uploadPromise.finally(() => {
      pendingUploadPromise = undefined;
      if (currentView === 'studio') {
        render();
      }
    });
    render();
  });

  document.querySelector('[data-action="publish"]')?.addEventListener('click', () => {
    const project = getActiveProject();

    if (!project.versions.length) {
      return;
    }

    void publishProject(project.id)
      .then((result) => {
        applyServerProject(result.project, result.version);
        saveProjects();
        render();
      })
      .catch((error) => {
        console.error(error);
      });
  });

  document.querySelector('[data-action="new-project"]')?.addEventListener('click', () => {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: `Splat Game ${projects.length + 1}`,
      prompt: defaultPrompt,
      modelName: '',
      modelUrl: '',
      modelSource: undefined,
      status: 'draft',
      updatedAt: now,
      versions: [],
    };

    projects = [project, ...projects];
    activeProjectId = project.id;
    if (uploadedModelUrl.startsWith('blob:')) {
      URL.revokeObjectURL(uploadedModelUrl);
    }
    uploadedModelName = '';
    uploadedModelUrl = '';
    generationState = 'idle';
    activeGenerationStep = 0;
    currentView = 'studio';
    saveProjects();
    render();
  });

  document.querySelector('[data-action="play-latest"]')?.addEventListener('click', () => {
    const hasGeneratedProject = projects.some((project) => project.versions.length > 0);
    generationState = hasGeneratedProject ? 'ready' : generationState;
    currentView = hasGeneratedProject ? 'studio' : 'home';
    render();
  });

  document.querySelectorAll<HTMLAnchorElement>('[data-view]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      currentView = link.dataset.view === 'studio' ? 'studio' : 'home';
      window.history.replaceState(null, '', currentView === 'studio' ? '#create' : '#home');
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-project-id]').forEach((button) => {
    button.addEventListener('click', () => {
      activeProjectId = button.dataset.projectId ?? activeProjectId;
      uploadedModelName = getActiveProject().modelSource === 'uploaded' ? getActiveProject().modelName : '';
      uploadedModelUrl = getActiveProject().modelSource === 'uploaded' ? getActiveProject().modelUrl || '' : '';
      generationState = 'ready';
      activeGenerationStep = generationSteps.length;
      currentView = 'studio';
      render();
    });
  });

  document.querySelector('[data-action="toggle-preview-fullscreen"]')?.addEventListener('click', () => {
    previewFullscreen = !previewFullscreen;
    render();
  });

  window.removeEventListener('keydown', handleStudioEscape);
  window.addEventListener('keydown', handleStudioEscape);
}

function handleStudioEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !previewFullscreen) {
    return;
  }

  previewFullscreen = false;
  render();
}

function startGeneration(prompt: string) {
  clearGenerationTimers();
  const token = ++generationToken;
  generationState = 'working';
  activeGenerationStep = 0;
  currentView = 'studio';
  render();

  const buildPromise = generateGame(prompt, token).catch((error) => {
    console.error(error);
    return null;
  });
  generationSteps.forEach((_, index) => {
    const timer = window.setTimeout(() => {
      if (token !== generationToken) {
        return;
      }
      activeGenerationStep = index;
      refreshGenerationProgress();
    }, index * 620);
    generationTimers.push(timer);
  });

  const finishTimer = window.setTimeout(() => {
    void buildPromise.then((result) => {
      if (token !== generationToken) {
        return;
      }

      if (result) {
        applyBuildResult(result);
      }

      generationState = 'ready';
      activeGenerationStep = generationSteps.length;
      clearGenerationTimers();
      render();
    });
  }, generationSteps.length * 620 + 120);
  generationTimers.push(finishTimer);
}

function clearGenerationTimers() {
  generationTimers.forEach((timer) => window.clearTimeout(timer));
  generationTimers = [];
}

function applyBuildResult(result: WorkspaceGenerationResult) {
  const project = getActiveProject();
  project.prompt = result.project.prompt;
  project.name = result.project.name;
  project.modelName = result.project.modelName;
  project.modelUrl = result.project.modelUrl;
  project.modelSource = result.project.modelSource;
  project.status = result.project.status;
  project.updatedAt = result.project.updatedAt;
  project.publishedUrl = result.project.publishedUrl;
  project.versions = [normalizeVersion(result.version), ...project.versions.filter((item) => item.id !== result.version.id)];
  uploadedModelName = project.modelSource === 'uploaded' ? project.modelName : '';
  uploadedModelUrl = project.modelSource === 'uploaded' ? project.modelUrl || '' : '';
  saveProjects();
}

function applyServerProject(project: WorkspaceProjectRecord, version?: GameVersion) {
  const active = getActiveProject();
  active.prompt = project.prompt;
  active.name = project.name;
  active.modelName = project.modelName;
  active.modelUrl = project.modelUrl;
  active.modelSource = project.modelSource;
  active.status = project.status;
  active.updatedAt = project.updatedAt;
  active.publishedUrl = project.publishedUrl;
  if (version) {
    active.versions = [normalizeVersion(version), ...active.versions.filter((item) => item.id !== version.id)];
  } else if (project.runs?.length) {
    active.versions = project.runs.map(normalizeVersion);
  }
  uploadedModelName = active.modelSource === 'uploaded' ? active.modelName : '';
  uploadedModelUrl = active.modelSource === 'uploaded' ? active.modelUrl || '' : '';
}

function normalizeVersion(version: GameVersion): GameVersion {
  return {
    ...version,
    mechanics: Array.isArray(version.mechanics) ? version.mechanics : [],
    npcArchetypes: Array.isArray(version.npcArchetypes) ? version.npcArchetypes : [],
  };
}

function refreshGenerationProgress() {
  const status = document.querySelector<HTMLElement>('[data-generation-status]');
  if (status) {
    status.textContent = statusMessage(getActiveProject().status, generationState);
  }

  document.querySelector('.preview-title span')?.replaceChildren(
    document.createTextNode(generationSteps[activeGenerationStep]?.label ?? 'Generating'),
  );

  document.querySelectorAll<HTMLElement>('.pipeline-list li').forEach((item, index) => {
    const state =
      generationState === 'ready' || activeGenerationStep > index
        ? 'done'
        : generationState === 'working' && activeGenerationStep === index
          ? 'active'
          : 'pending';

    item.classList.remove('active', 'done', 'pending');
    item.classList.add(state);
  });
}

async function generateGame(prompt: string, token: number) {
  const project = getActiveProject();
  const uploadPromise = pendingUploadPromise;
  if (uploadPromise) {
    await uploadPromise.catch(() => undefined);
  }

  const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      name: project.name,
      modelName: project.modelName,
      modelSource: project.modelSource,
      modelUrl: project.modelUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`Generation request failed with ${response.status}.`);
  }

  const result = (await response.json()) as WorkspaceGenerationResult;
  if (token !== generationToken) {
    return result;
  }

  applyBuildResult(result);
  return result;
}

async function uploadProjectAsset(projectId: string, file: File) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-filename': file.name,
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}.`);
  }

  return (await response.json()) as { project: WorkspaceProjectRecord };
}

async function publishProject(projectId: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Publish failed with ${response.status}.`);
  }

  return (await response.json()) as WorkspacePublishResult;
}

function coverCard(game: ShowcaseGame, index: number, size: 'large' | 'small') {
  return `
    <article class="game-card ${size} ${game.style}" style="--delay:${index * 42}ms">
      <div class="cover-art">
        <div class="cover-shape shape-a"></div>
        <div class="cover-shape shape-b"></div>
        <div class="cover-title">${h(game.title)}</div>
        <div class="play-count">${playIcon()} ${h(game.plays)}</div>
      </div>
      <div class="creator-row">
        <span class="avatar"></span>
        <strong>${h(game.creator)}</strong>
      </div>
    </article>
  `;
}

function generatedCard(project: Project, index: number) {
  const latest = project.versions[0];
  return `
    <button class="game-card small generated-cover" data-project-id="${project.id}" style="--delay:${index * 42}ms">
      <div class="cover-art generated-art ${latest?.snapshotUrl ? 'has-snapshot' : ''}">
        ${latest?.snapshotUrl ? `<img class="generated-snapshot" src="${h(latest.snapshotUrl)}" alt="" aria-hidden="true" />` : ''}
        <div class="cover-shape shape-a"></div>
        <div class="cover-shape shape-b"></div>
        <div class="cover-title">${h(project.name)}</div>
        <div class="play-count">${playIcon()} ${h(statusLabel(project.status))}</div>
      </div>
      <div class="creator-row">
        <span class="avatar"></span>
        <strong>${h(latest?.shareUrl ?? 'Draft build')}</strong>
      </div>
    </button>
  `;
}

function homeView(generatedShelf: Project[]) {
  return `
    <section class="shelf">
      <div class="shelf-head">
        <h2>Players' Choice</h2>
        <button class="text-button">View all</button>
      </div>
      <div class="cover-row large-row">
        ${playersChoice.map((game, index) => coverCard(game, index, 'large')).join('')}
      </div>
    </section>

    <section class="shelf">
      <div class="shelf-head">
        <h2>Trending</h2>
        <button class="text-button">Refresh</button>
      </div>
      <div class="cover-row">
        ${trending.map((game, index) => coverCard(game, index, 'small')).join('')}
      </div>
    </section>

    <section class="shelf">
      <div class="shelf-head">
        <h2>Recommended For You</h2>
        <button class="text-button" data-action="new-project">New project</button>
      </div>
      <div class="cover-row generated-row">
        ${
          generatedShelf.length
            ? generatedShelf.map((item, index) => generatedCard(item, index)).join('')
            : emptyRecommendation()
        }
      </div>
    </section>
  `;
}

function studioView(project: Project, latestVersion: GameVersion | undefined, mechanics: string[]) {
  const hasPreview = generationState === 'working' || generationState === 'ready';
  const commandLines = generationCommand(project);
  const previewExpanded = previewFullscreen && hasPreview;
  return `
    <section class="studio-header" aria-label="Create studio introduction">
      <div class="studio-title">
        <p class="kicker">Create Studio</p>
        <h1>Build a game from your splat</h1>
      </div>
      <div class="studio-summary" aria-label="Studio generation summary">
        <span>Natural language to PlayCanvas FPS</span>
        <strong>${h(sceneSourceLabel(project))}</strong>
        <div class="studio-flow">
          <span>Prompt</span>
          <span>SOG stream</span>
          <span>Collision</span>
          <span>NPC game</span>
        </div>
      </div>
    </section>

    <section class="studio-grid ${previewExpanded ? 'is-preview-expanded' : ''}" aria-label="Create game controls">
      <form class="creator-console studio-console" id="creator-form">
        <div class="create-copy">
          <span>Prompt</span>
          <strong>Tell the agent what to make</strong>
        </div>
        <label class="sr-only" for="prompt-input">Game prompt</label>
        <textarea id="prompt-input" rows="6">${h(project.prompt)}</textarea>
        <div class="create-actions">
          <label class="upload-pill">
            <input id="model-upload" type="file" accept=".ply,.sog,.spz,.ksplat" />
            <span>${uploadIcon()} ${h(project.modelName || `Use built-in ${builtInTestScene.name}`)}</span>
          </label>
          <button class="generate-button" type="submit">
            ${sparkIcon()} Generate game
          </button>
        </div>
        ${hasPreview ? previewCanvasPanel(project, latestVersion, previewExpanded) : waitingCanvasPanel()}
      </form>

      ${previewExpanded ? '' : `
      <div class="pipeline-panel">
        <div class="create-copy">
          <span>Generation process</span>
          <strong data-generation-status>${statusMessage(project.status, generationState)}</strong>
        </div>
        <div class="asset-source ${project.modelSource === 'builtin' || !project.modelName ? 'builtin' : 'uploaded'}">
          <span>Scene source</span>
          <strong>${h(sceneSourceLabel(project))}</strong>
          <code>${h(sceneSourcePath(project))}</code>
        </div>
        <div class="asset-source asset-products">
          <span>Generated assets</span>
          <strong>${h(generatedAssetSummary(project))}</strong>
          <code>${h(generatedAssetPaths(project))}</code>
        </div>
        <div class="audit-list" aria-label="Generation implementation audit">
          ${generationAuditRows(project, latestVersion).map((item) => `
            <div class="${item.status}">
              <span>${h(item.statusLabel)}</span>
              <strong>${h(item.label)}</strong>
              <p>${h(item.detail)}</p>
            </div>
          `).join('')}
        </div>
        <div class="command-block">
          <span>Reference command</span>
          <pre>${h(commandLines)}</pre>
        </div>
      </div>
      `}
    </section>

    ${previewExpanded ? '' : `
    <section class="pipeline-rail" aria-label="Generation steps">
      <div class="pipeline-rail-head">
        <p class="kicker">Generation steps</p>
        <strong>Prompt to playable browser build</strong>
      </div>
      <ol class="pipeline-list">
        ${generationSteps.map((step, index) => generationStepRow(step, index)).join('')}
      </ol>
    </section>
    `}

    ${hasPreview && !previewExpanded ? buildPanel(project, latestVersion, mechanics) : ''}
  `;
}

function previewCanvasPanel(project: Project, latestVersion: GameVersion | undefined, expanded: boolean) {
  return `
    <section class="preview-card inline-preview ${expanded ? 'is-fullscreen' : ''}" aria-label="Live PlayCanvas generation preview">
      <div class="preview-placeholder" aria-hidden="true">
        <span class="scan-plane plane-a"></span>
        <span class="scan-plane plane-b"></span>
        <span class="scan-ridge ridge-a"></span>
        <span class="scan-ridge ridge-b"></span>
        <span class="scan-point point-a"></span>
        <span class="scan-point point-b"></span>
        <span class="scan-point point-c"></span>
        <span class="scan-point point-d"></span>
      </div>
      <canvas id="preview-canvas" aria-label="Generated game preview"></canvas>
      <div class="preview-controls">
        <div class="preview-badge">PlayCanvas preview</div>
        <button class="preview-expand-button" type="button" data-action="toggle-preview-fullscreen" aria-pressed="${expanded}">
          ${expanded ? collapseIcon() : expandIcon()}
          <span>${expanded ? 'Exit full screen' : 'Full screen'}</span>
        </button>
      </div>
      <div class="preview-load" data-preview-status>Preparing PlayCanvas scene</div>
      <div class="preview-title">
        <span>${generationState === 'working' ? h(generationSteps[activeGenerationStep]?.label ?? 'Generating') : statusLabel(project.status)}</span>
        <strong>${h(latestVersion?.title ?? 'Creating 3D scene')}</strong>
      </div>
      <div class="runtime-hud" aria-label="Playable runtime status">
        <span data-runtime-status>${generationState === 'working' ? 'Building runtime' : 'WASD move · drag look · space tag'}</span>
        <strong data-runtime-objective>${h(latestVersion?.objective ?? 'Reach the energy core')}</strong>
        <em data-runtime-enemies>${h(runtimeEnemyLabel(latestVersion))}</em>
      </div>
    </section>
  `;
}

function buildPanel(project: Project, latestVersion: GameVersion | undefined, mechanics: string[]) {
  return `
    <section class="build-strip" aria-label="Generated build">
      <div class="build-panel">
        <p class="kicker">Generated build</p>
        <h2>${h(generationState === 'working' ? 'Building game...' : project.name)}</h2>
        <p>${h(latestVersion?.summary ?? 'The game build will appear here after the generation pipeline finishes.')}</p>
        <div class="mechanics">
          ${mechanics.map((item) => `<span>${h(item)}</span>`).join('')}
        </div>
        <div class="share-line">
          <code>${h(latestVersion?.shareUrl ?? 'Waiting for package step')}</code>
          <button class="publish-button" data-action="publish" ${latestVersion ? '' : 'disabled'}>Publish</button>
        </div>
      </div>
    </section>
  `;
}

function waitingCanvasPanel() {
  return `
    <section class="canvas-waiting" aria-label="Generation waiting state">
      <p class="kicker">Waiting for generation</p>
      <h2>No 3D canvas yet</h2>
      <p>
        Click Generate game to create the PlayCanvas scene. The agent will then load the splat,
        build collision, create navigation, and add gameplay content step by step.
      </p>
    </section>
  `;
}

function generationCommand(project: Project) {
  const sourceAsset = project.modelSource === 'uploaded' && project.modelName ? project.modelName : builtInTestScene.name;
  const sourceStem = sourceAsset.replace(/\.[^.]+$/, '');

  return [
    `splat-transform ${sourceAsset} \\`,
    `  --seed-pos 0,1,0 --voxel-params 0.05,0.1 --voxel-carve 1.6,0.2 -K \\`,
    `  ${sourceStem}.sog`,
    `recast ${sourceStem}.collision.glb navmesh.bin`,
  ].join('\n');
}

function generationStepRow(step: GenerationStep, index: number) {
  const status =
    generationState === 'ready' || activeGenerationStep > index
      ? 'done'
      : generationState === 'working' && activeGenerationStep === index
        ? 'active'
        : 'pending';

  return `
    <li class="${status}">
      <span>${index + 1}</span>
      <div>
        <strong>${h(step.label)}</strong>
        <p>${h(step.detail)}</p>
      </div>
    </li>
  `;
}

function emptyRecommendation() {
  return `
    <div class="empty-rec">
      <strong>No generated games yet</strong>
      <span>Upload a splat and describe an FPS to create your first playable card.</span>
    </div>
  `;
}

function defaultMechanics() {
  return ['FPS movement', 'Splat scene', 'Collision GLB', 'Recast navmesh', '8 AI NPCs', 'Share build'];
}

function sceneSourceLabel(project: Project) {
  if (project.modelSource === 'uploaded' && project.modelName) {
    return `Uploaded asset: ${project.modelName}`;
  }

  if (project.modelSource === 'builtin' || !project.modelName) {
    return `Built-in test asset: ${builtInTestScene.name}`;
  }

  return project.modelName;
}

function sceneSourcePath(project: Project) {
  if (project.modelUrl?.startsWith('/workspace/')) {
    return project.modelUrl;
  }

  if (project.modelSource === 'uploaded' && project.modelName) {
    return 'Browser upload, copied into workspace for this generation session';
  }

  return builtInTestScene.path;
}

function generatedAssetSummary(project: Project) {
  const latest = project.versions[0];
  if (latest?.streamedUrl && latest.collisionUrl && latest.navmeshUrl) {
    return `${latest.streamedUrl.split('/').pop()} + ${latest.collisionUrl.split('/').pop()} + ${latest.navmeshUrl.split('/').pop()} + gameplay-runtime.json`;
  }

  const stem = project.modelSource === 'uploaded' && project.modelName
    ? project.modelName.replace(/\.[^.]+$/, '')
    : builtInTestScene.id;

  return `${stem}.sog + ${stem}.collision.glb + navmesh.bin`;
}

function generatedAssetPaths(project: Project) {
  const latest = project.versions[0];
  if (latest?.streamedUrl && latest.collisionUrl && latest.navmeshUrl) {
    return `${latest.streamedUrl} | ${latest.collisionUrl} | ${latest.navmeshUrl} | ${latest.runtimeUrl || 'gameplay-runtime.json'} | ${latest.behaviorTreeUrl || 'behavior-tree.json'}`;
  }

  if (project.modelSource === 'uploaded' && project.modelName) {
    const stem = project.modelName.replace(/\.[^.]+$/, '');
    return `${stem}.sog | ${stem}.collision.glb | navmesh.bin`;
  }

  return `${builtInTestScene.streamedPath} | ${builtInTestScene.collisionPath} | ${builtInTestScene.navmeshPath}`;
}

function runtimeEnemyLabel(latestVersion: GameVersion | undefined) {
  const count = latestVersion?.npcArchetypes?.length || 8;
  return `${count} AI patrols armed`;
}

function generationAuditRows(project: Project, latestVersion: GameVersion | undefined) {
  const hasStream = Boolean(latestVersion?.streamedUrl);
  const hasCollision = Boolean(latestVersion?.collisionUrl);
  const hasNavmesh = Boolean(latestVersion?.navmeshUrl);
  const hasNpcPlan = Boolean(latestVersion?.npcArchetypes?.length);
  const hasRuntime = Boolean(latestVersion?.runtimeUrl && latestVersion?.behaviorTreeUrl);
  return [
    {
      status: hasStream ? 'ready' : 'pending',
      statusLabel: hasStream ? 'Ready' : 'Pending',
      label: 'SOG / preview package',
      detail: hasStream
        ? 'The source scan has been converted into a streamed SOG package and PlayCanvas preview bundle.'
        : 'The source scan will be converted into a streamed SOG package and PlayCanvas-readable preview bundle.',
    },
    {
      status: hasCollision ? 'ready' : 'pending',
      statusLabel: hasCollision ? 'Ready' : 'Pending',
      label: 'Collision GLB',
      detail: hasCollision
        ? 'splat-transform emitted the collision GLB from the source splat.'
        : 'splat-transform will emit the collision GLB from the source splat.',
    },
    {
      status: hasNavmesh ? 'ready' : 'pending',
      statusLabel: hasNavmesh ? 'Ready' : 'Pending',
      label: 'Recast navmesh.bin',
      detail: hasNavmesh
        ? 'Recast generated the binary navigation mesh for runtime pathfinding.'
        : 'Recast will generate navmesh.bin for runtime pathfinding.',
    },
    {
      status: hasNpcPlan ? 'ready' : 'pending',
      statusLabel: hasNpcPlan ? 'Ready' : 'Pending',
      label: 'NPC / character generation',
      detail: hasNpcPlan
        ? 'The LLM produced eight NPC archetypes with roles, patrols, and behaviors.'
        : 'The prompt asks for eight AI enemies; the NPC plan is still being produced.',
    },
    {
      status: hasRuntime ? 'ready' : 'pending',
      statusLabel: hasRuntime ? 'Ready' : 'Pending',
      label: 'Playable runtime',
      detail: hasRuntime
        ? 'Generated gameplay-runtime.json and behavior-tree.json for player controls, objectives, and NPC states.'
        : 'The runtime spec will define controls, objectives, NPC routes, and behavior-tree state transitions.',
    },
  ];
}

function resolveSceneAssets(project: Project, latestVersion: GameVersion | undefined, state: typeof generationState) {
  if (latestVersion?.streamedUrl) {
    return {
      sourceUrl: latestVersion.sourceUrl || project.modelUrl || builtInTestScene.sourceUrl,
      streamedUrl: latestVersion.streamedUrl,
      fallbackUrl: latestVersion.sourceUrl || project.modelUrl || builtInTestScene.sourceUrl,
      collisionUrl: latestVersion.collisionUrl || '',
      navmeshUrl: latestVersion.navmeshUrl || '',
      flipVertical: project.modelSource === 'builtin' || project.modelName === builtInTestScene.name,
    };
  }

  const fallbackUrl = project.modelUrl || builtInTestScene.sourceUrl;
  return {
    sourceUrl: fallbackUrl,
    streamedUrl: state === 'working' ? fallbackUrl : builtInTestScene.sourceUrl,
    fallbackUrl,
    collisionUrl: builtInTestScene.collisionUrl,
    navmeshUrl: builtInTestScene.navmeshUrl,
    flipVertical: project.modelSource === 'builtin' || project.modelName === builtInTestScene.name,
  };
}

function buildMechanics(prompt: string) {
  const lower = prompt.toLowerCase();
  const mechanics = [...defaultMechanics()];

  if (lower.includes('collect') || prompt.includes('收集')) {
    mechanics.push('Collection objective');
  }

  if (lower.includes('stealth') || prompt.includes('潜行')) {
    mechanics.push('Enemy awareness');
  }

  if (lower.includes('timer') || prompt.includes('计时')) {
    mechanics.push('Timed extraction');
  }

  return Array.from(new Set(mechanics)).slice(0, 9);
}

function extractTitle(prompt: string) {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  const phrase = clean.split(/[，。,.]/)[0] || 'Generated Splat FPS';
  const withoutLead = phrase.replace(/^turn my\s+/i, '').replace(/^make\s+/i, '');
  return withoutLead.length > 34 ? `${withoutLead.slice(0, 34)}...` : withoutLead;
}

function statusLabel(status: ProjectStatus) {
  const labels = {
    draft: 'Draft',
    generated: 'Generated',
    published: 'Published',
  };

  return labels[status];
}

function statusMessage(status: ProjectStatus, state: typeof generationState) {
  if (state === 'idle') {
    return 'Click Generate to create the 3D canvas.';
  }

  if (state === 'working') {
    return 'Building your game card...';
  }

  if (status === 'generated') {
    return 'Ready to preview.';
  }

  if (status === 'published') {
    return 'Published.';
  }

  return 'Start with the FPS template.';
}

function navItem(label: string, icon: string, active: boolean, view?: AppView) {
  return `
    <a class="nav-item ${active ? 'active' : ''}" href="#${view ?? 'home'}" ${view ? `data-view="${view}"` : ''}>
      ${icon}
      <span>${label}</span>
    </a>
  `;
}

function h(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return entities[character];
  });
}

function icon(path: string) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">${path}</svg>`;
}

function starIcon() {
  return icon(
    '<path d="M12 3.4 14.6 8.7 20.4 9.5 16.2 13.6 17.2 19.4 12 16.7 6.8 19.4 7.8 13.6 3.6 9.5 9.4 8.7 12 3.4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  );
}

function playIcon() {
  return icon('<path d="M8 5.5v13l10-6.5L8 5.5Z" fill="currentColor"/>');
}

function homeIcon() {
  return icon('<path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-5v-5h-4v5H5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>');
}

function plusIcon() {
  return icon('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
}

function userIcon() {
  return icon('<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
}

function loginIcon() {
  return icon('<path d="M10 7V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-2M4 12h10M11 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
}

function gridIcon() {
  return icon('<path d="M5 5h3v3H5V5Zm6 0h3v3h-3V5Zm6 0h3v3h-3V5ZM5 11h3v3H5v-3Zm6 0h3v3h-3v-3Zm6 0h3v3h-3v-3ZM5 17h3v3H5v-3Zm6 0h3v3h-3v-3Zm6 0h3v3h-3v-3Z" fill="currentColor"/>');
}

function uploadIcon() {
  return icon('<path d="M12 16V5M8 9l4-4 4 4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
}

function sparkIcon() {
  return icon('<path d="m12 3 1.8 5.1L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-1.9L12 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>');
}

function expandIcon() {
  return icon('<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 9 4 4M20 4l-5 5M4 20l5-5M15 15l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
}

function collapseIcon() {
  return icon('<path d="M9 3v5H4M15 3v5h5M9 21v-5H4M15 21v-5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9 9 4M20 4l-5 5M4 20l5-5M15 15l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
}
