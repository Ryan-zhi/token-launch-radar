// Token launch radar: the handover program (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, scores every rankable pre-token
// protocol with the peer-multiple model in lib/model.ts, and lays out the
// entry in the output directory:
//   board.json    the ranked board ({ rows: [...] })
//   data.js       the dashboard's dataset (window.RADAR = ...)
//   dashboard/    the static dashboard, copied from this repository
//   screenshots/  the three judged views, copied from this repository
//   dossier.json  the judge's summary, built by vendor/makefun-board.ts
//
// Run it locally with:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
// In the grader's container the snapshot is mounted at /input and the
// output directory is /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputPath = flagValue('input', '/input');
const snapshotFile = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotFile)) fail(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory>`);
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const board = buildBoard(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);
const radar = buildRadar(snapshot, board);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const done: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    done.push(name);
  }
  return done;
}

copyFlat(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyFlat(join(root, 'screenshots'), join(outDir, 'screenshots'));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3 (the board, a detail view, a filtered view)`);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: not a plain image file name`);

// Written last on purpose: the scorer rebuilds the dossier from this output
// directory and compares it byte for byte.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored, ${radar.live_size} live set aside\n` +
    `token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json under ${outDir}\n`,
);
