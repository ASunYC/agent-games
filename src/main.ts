import './style.css';
import type { GamePreviewRuntime } from './playcanvasPreview';

type ProjectStatus = 'draft' | 'generated' | 'published';
type AppView = 'home' | 'studio';

type Project = {
  id: string;
  name: string;
  prompt: string;
  modelName: string;
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
const defaultPrompt =
  'Turn my abandoned building Gaussian splat into a browser FPS with exploration, collision, a navmesh, eight AI enemies, an energy-core objective, and a share link.';

const generationSteps: GenerationStep[] = [
  {
    label: 'Read prompt',
    detail: 'Extract game genre, objective, camera, win condition, and asset requirements.',
  },
  {
    label: 'Load Gaussian scene',
    detail: 'Stream the uploaded splat into the PlayCanvas preview as the world source.',
  },
  {
    label: 'Prepare collision',
    detail: 'Approximate floors, walls, ramps, and blockers with generated collider bodies.',
  },
  {
    label: 'Build navmesh',
    detail: 'Generate Recast navigation zones so characters can walk through the scene.',
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
    label: 'Package game',
    detail: 'Create a versioned browser build with a shareable play link.',
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
let uploadedModelName = getActiveProject().modelName;
let previewRuntime: GamePreviewRuntime | undefined;
let previewMountId = 0;
let generationState: 'idle' | 'working' | 'ready' = getActiveProject().versions.length
  ? 'ready'
  : 'idle';
let currentView: AppView = 'home';
let activeGenerationStep = 0;
let generationTimers: number[] = [];

render();

function loadProjects(): Project[] {
  const raw = window.localStorage.getItem(storageKey);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
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
    const previewState = {
      status: project.status,
      modelName: project.modelName,
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
      status: 'draft',
      updatedAt: now,
      versions: [],
    };

    projects = [project, ...projects];
    activeProjectId = project.id;
    uploadedModelName = '';
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
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-project-id]').forEach((button) => {
    button.addEventListener('click', () => {
      activeProjectId = button.dataset.projectId ?? activeProjectId;
      uploadedModelName = getActiveProject().modelName;
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
      render();
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

function generateGame(prompt: string) {
  const project = getActiveProject();
  const now = new Date().toISOString();
  const modelName = uploadedModelName || project.modelName || 'abandoned-scene.sog';
  const versionNumber = project.versions.length + 1;
  const title = extractTitle(prompt);
  const version: GameVersion = {
    id: crypto.randomUUID(),
    title,
    summary: `${title} uses ${modelName} as a streamed Gaussian scene with collision, Recast navigation, AI enemies, and a browser share build.`,
    mechanics: buildMechanics(prompt),
    shareUrl: `https://agent.games/play/${project.id.slice(0, 8)}-v${versionNumber}`,
    createdAt: now,
  };

  project.prompt = prompt;
  project.name = title;
  project.modelName = modelName;
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
  return `
    <section class="studio-header" aria-label="Create studio introduction">
      <div>
        <p class="kicker">Create Studio</p>
        <h1>Build a game from your splat</h1>
      </div>
      <p>
        Describe the game, upload a Gaussian scene, then watch the generator load the world,
        create collision and navigation, and add gameplay with NPCs.
      </p>
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
            <span>${uploadIcon()} ${h(project.modelName || 'Upload splat')}</span>
          </label>
          <button class="generate-button" type="submit">
            ${sparkIcon()} Generate game
          </button>
        </div>
      </form>

      <div class="pipeline-panel">
        <div class="create-copy">
          <span>Generation process</span>
          <strong>${statusMessage(project.status, generationState)}</strong>
        </div>
        <ol class="pipeline-list">
          ${generationSteps.map((step, index) => generationStepRow(step, index)).join('')}
        </ol>
      </div>
    </section>

    ${
      hasPreview
        ? `
          <section class="studio-strip" aria-label="Create studio">
            <div class="preview-card">
              <canvas id="preview-canvas" aria-label="Generated game preview"></canvas>
              <div class="preview-badge">PlayCanvas preview</div>
              <div class="preview-title">
                <span>${generationState === 'working' ? h(generationSteps[activeGenerationStep]?.label ?? 'Generating') : statusLabel(project.status)}</span>
                <strong>${h(latestVersion?.title ?? 'Creating 3D scene')}</strong>
              </div>
            </div>
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
        `
        : `
          <section class="studio-awaiting" aria-label="Generation waiting state">
            <div>
              <p class="kicker">Waiting for generation</p>
              <h2>No 3D canvas yet</h2>
              <p>
                Click Generate game to create the PlayCanvas scene. The agent will then load the splat,
                build collision, create navigation, and add gameplay content step by step.
              </p>
            </div>
            <button class="generate-button" type="submit" form="creator-form">
              ${sparkIcon()} Generate game
            </button>
          </section>
        `
    }
  `;
}

function generationStepRow(step: GenerationStep, index: number) {
  const generated = getActiveProject().status !== 'draft' && generationState !== 'working';
  const status =
    generated || generationState === 'ready' || activeGenerationStep > index
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
