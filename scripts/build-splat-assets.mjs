import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sceneDir = join(root, 'data', '23ebe85c');
const source = join(sceneDir, '23ebe85c.ply');
const streamed = join(sceneDir, '23ebe85c.sog');
const previewMeta = join(sceneDir, 'preview', 'meta.json');
const voxel = join(sceneDir, '23ebe85c.voxel.json');

if (!existsSync(source)) {
  throw new Error(`Built-in test PLY not found: ${source}`);
}

if (
  existsSync(streamed) &&
  existsSync(join(sceneDir, '23ebe85c.collision.glb')) &&
  existsSync(voxel) &&
  existsSync(previewMeta)
) {
  console.log('Built-in SOG, collision GLB, and voxel data already exist.');
  process.exit(0);
}

if (!existsSync(streamed)) {
  run('npx', ['@playcanvas/splat-transform', '-w', source, streamed]);
}
if (!existsSync(previewMeta)) {
  run('npx', ['@playcanvas/splat-transform', '-w', source, previewMeta]);
}
if (
  !run('npx', [
    '@playcanvas/splat-transform',
    '-w',
    source,
    '--seed-pos',
    '0,1,0',
    '--voxel-params',
    '0.05,0.1',
    '--voxel-carve',
    '1.6,0.2',
    '-K',
    voxel,
  ])
) {
  console.warn('Retrying collision build with a coarser voxel grid and a larger heap.');
  run(
    'npx',
    [
      '@playcanvas/splat-transform',
      '-w',
      source,
      '--seed-pos',
      '0,1,0',
      '--voxel-params',
      '0.12,0.12',
      '--voxel-carve',
      '2.4,0.3',
      '-K',
      'faces',
      voxel,
    ],
    {
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
  );
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  return result.status === 0;
}
