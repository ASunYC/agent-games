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
};

type GameVersion = {
  id: string;
  title: string;
  summary: string;
  mechanics: string[];
  shareUrl: string;
  createdAt: string;
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

const storageKey = 'agent-games-projects';
const builtInTestScene = {
  id: '23ebe85c',
  name: '23ebe85c.ply',
  sourceUrl: '/data/23ebe85c/23ebe85c.ply',
  streamedUrl: '/data/23ebe85c/23ebe85c.sog',
  previewUrl: '/data/23ebe85c/preview/meta.json',
  previewImageUrl: '/data/23ebe85c/preview/preview.webp',
  collisionUrl: '/data/23ebe85c/23ebe85c.collision.glb',
  voxelUrl: '/data/23ebe85c/23ebe85c.voxel.json',
  navmeshUrl: '/data/23ebe85c/navmesh.bin',
  path: 'data/23ebe85c/23ebe85c.ply',
  previewPath: 'data/23ebe85c/preview/meta.json',
  streamedPath: 'data/23ebe85c/23ebe85c.sog',
  collisionPath: 'data/23ebe85c/23ebe85c.collision.glb',
  navmeshPath: 'data/23ebe85c/navmesh.bin',
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
    detail: 'Use the uploaded PLY/SOG or the built-in 23ebe85c.ply test scan as the input.',
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
      modelName: isBuiltInSceneProject(project) ? builtInTestScene.name : project.modelName,
      modelSource: isBuiltInSceneProject(project) ? 'builtin' : project.modelSource,
      modelUrl: project.modelUrl?.startsWith('blob:') ? '' : project.modelUrl,
    }));
  } catch {
    return [];
  }
}

function isBuiltInSceneProject(project: Project) {
  return project.modelName === builtInTestScene.name || Boolean(project.modelUrl?.includes('/data/23ebe85c/'));
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
    const sceneAssets = resolveSceneAssets(project);
    const previewState = {
      status: project.status,
      modelName: project.modelName,
      sceneLabel: sceneSourceLabel(project),
      modelUrl: sceneAssets.streamedUrl,
      fallbackModelUrl: sceneAssets.sourceUrl,
      flipVertical: sceneAssets.flipVertical,
      collisionUrl: sceneAssets.collisionUrl,
      navmeshUrl: sceneAssets.navmeshUrl,
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
    if (uploadedModelUrl.startsWith('blob:')) {
      URL.revokeObjectURL(uploadedModelUrl);
    }

    uploadedModelUrl = URL.createObjectURL(file);
    uploadedModelName = file.name;
    project.modelName = file.name;
    project.modelUrl = uploadedModelUrl;
    project.modelSource = 'uploaded';
    project.updatedAt = new Date().toISOString();
    currentView = 'studio';
    saveProjects();
    render();
  });

  document.querySelector('[data-action="publish"]')?.addEventListener('click', () => {
    const project = getActiveProject();

    if (!project.versions.length) {
      return;
    }

    project.status = 'published';
    project.updatedAt = new Date().toISOString();
    saveProjects();
    render();
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
}

function startGeneration(prompt: string) {
  clearGenerationTimers();
  generationState = 'working';
  activeGenerationStep = 0;
  currentView = 'studio';
  render();

  generationSteps.forEach((_, index) => {
    const timer = window.setTimeout(() => {
      activeGenerationStep = index;
      refreshGenerationProgress();
    }, index * 620);
    generationTimers.push(timer);
  });

  const finishTimer = window.setTimeout(() => {
    generateGame(prompt);
    generationState = 'ready';
    activeGenerationStep = generationSteps.length;
    clearGenerationTimers();
    render();
  }, generationSteps.length * 620 + 120);
  generationTimers.push(finishTimer);
}

function clearGenerationTimers() {
  generationTimers.forEach((timer) => window.clearTimeout(timer));
  generationTimers = [];
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

function generateGame(prompt: string) {
  const project = getActiveProject();
  const now = new Date().toISOString();
  const usingBuiltIn = !uploadedModelName && project.modelSource !== 'uploaded';
  const modelName = usingBuiltIn ? builtInTestScene.name : uploadedModelName || project.modelName;
  const modelUrl = usingBuiltIn ? builtInTestScene.sourceUrl : resolveSceneAssets(project).sourceUrl;
  const versionNumber = project.versions.length + 1;
  const title = extractTitle(prompt);
  const version: GameVersion = {
    id: crypto.randomUUID(),
    title,
    summary: `${title} uses ${modelName} as the Gaussian scene source with collision, Recast navigation, AI enemies, and a browser share build.`,
    mechanics: buildMechanics(prompt),
    shareUrl: `https://agent.games/play/${project.id.slice(0, 8)}-v${versionNumber}`,
    createdAt: now,
  };

  project.prompt = prompt;
  project.name = title;
  project.modelName = modelName;
  project.modelUrl = modelUrl;
  project.modelSource = usingBuiltIn ? 'builtin' : 'uploaded';
  project.status = 'generated';
  project.updatedAt = now;
  project.versions = [version, ...project.versions];
  saveProjects();
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
      <div class="cover-art">
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

    <section class="studio-grid" aria-label="Create game controls">
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
        ${hasPreview ? previewCanvasPanel(project, latestVersion) : waitingCanvasPanel()}
      </form>

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
          ${generationAuditRows().map((item) => `
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
    </section>

    <section class="pipeline-rail" aria-label="Generation steps">
      <div class="pipeline-rail-head">
        <p class="kicker">Generation steps</p>
        <strong>Prompt to playable browser build</strong>
      </div>
      <ol class="pipeline-list">
        ${generationSteps.map((step, index) => generationStepRow(step, index)).join('')}
      </ol>
    </section>

    ${hasPreview ? buildPanel(project, latestVersion, mechanics) : ''}
  `;
}

function previewCanvasPanel(project: Project, latestVersion: GameVersion | undefined) {
  const previewStyle = ` style="--preview-image: url('${builtInTestScene.previewImageUrl}')"`;

  return `
    <section class="preview-card inline-preview" aria-label="Live PlayCanvas generation preview"${previewStyle}>
      <canvas id="preview-canvas" aria-label="Generated game preview"></canvas>
      <div class="preview-badge">PlayCanvas preview</div>
      <div class="preview-load" data-preview-status>Preparing PlayCanvas scene</div>
      <div class="preview-title">
        <span>${generationState === 'working' ? h(generationSteps[activeGenerationStep]?.label ?? 'Generating') : statusLabel(project.status)}</span>
        <strong>${h(latestVersion?.title ?? 'Creating 3D scene')}</strong>
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
  if (project.modelSource === 'uploaded' && project.modelName) {
    return 'Browser upload, used for this generation session';
  }

  return builtInTestScene.path;
}

function generatedAssetSummary(project: Project) {
  const stem = project.modelSource === 'uploaded' && project.modelName
    ? project.modelName.replace(/\.[^.]+$/, '')
    : builtInTestScene.id;

  return `${stem}.sog + ${stem}.collision.glb + navmesh.bin`;
}

function generatedAssetPaths(project: Project) {
  if (project.modelSource === 'uploaded' && project.modelName) {
    const stem = project.modelName.replace(/\.[^.]+$/, '');
    return `${stem}.sog | ${stem}.collision.glb | navmesh.bin`;
  }

  return `${builtInTestScene.streamedPath} | ${builtInTestScene.collisionPath} | ${builtInTestScene.navmeshPath}`;
}

function generationAuditRows() {
  return [
    {
      status: 'ready',
      statusLabel: 'Ready',
      label: 'SOG / preview package',
      detail: 'The built-in PLY has been converted into SOG plus a PlayCanvas-readable preview package.',
    },
    {
      status: 'ready',
      statusLabel: 'Ready',
      label: 'Collision GLB',
      detail: 'splat-transform emitted 23ebe85c.collision.glb from the source splat.',
    },
    {
      status: 'pending',
      statusLabel: 'Pending',
      label: 'Recast navmesh.bin',
      detail: 'The UI shows the step, but navmesh.bin has not been generated yet.',
    },
    {
      status: 'pending',
      statusLabel: 'Pending',
      label: 'NPC / character generation',
      detail: 'The prompt asks for eight AI enemies; no real character assets or behavior tree are spawned yet.',
    },
  ];
}

function resolveSceneAssets(project: Project) {
  if (project.modelSource === 'uploaded') {
    const sourceUrl = uploadedModelUrl || project.modelUrl || builtInTestScene.sourceUrl;
    const uploadedIsBuiltIn =
      project.modelName === builtInTestScene.name || sourceUrl.includes('/data/23ebe85c/');
    const uploadedIsStreamable = /\.(sog|ply)$/i.test(project.modelName);

    return {
      sourceUrl,
      streamedUrl: uploadedIsBuiltIn
        ? builtInTestScene.previewUrl
        : uploadedIsStreamable
          ? sourceUrl
          : builtInTestScene.streamedUrl,
      collisionUrl: builtInTestScene.collisionUrl,
      navmeshUrl: builtInTestScene.navmeshUrl,
      flipVertical: uploadedIsBuiltIn,
    };
  }

  return {
    sourceUrl: project.modelUrl || builtInTestScene.sourceUrl,
    streamedUrl: builtInTestScene.previewUrl,
    collisionUrl: builtInTestScene.collisionUrl,
    navmeshUrl: builtInTestScene.navmeshUrl,
    flipVertical: true,
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
