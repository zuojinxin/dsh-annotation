// node docs/render-demo.mjs — headless Edge + ffmpeg; the real plugin, invented data.
//
// Captures docs/preview.html frame by frame, then encodes the stills into
// docs/images/demo.gif and writes the screenshots in docs/screenshots/.
//
// Two reasons this exists instead of a screen recording of the actual app:
//
//   * privacy   a real recording carries session titles, account and workspace
//               names; the preview page carries invented ones and nothing else
//   * repeat    the timeline is a seekable function, so the same input gives the
//               same bytes, and the assertions below turn the recording into a
//               regression test -- if the toolbar, the markers or the reply chips
//               break, this throws instead of producing a plausible animation
//
// The captured pixels come from the REAL plugin: preview.html injects client.js
// verbatim, so only the surrounding window is imitated.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const EDGE = process.env.ANN_EDGE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FFMPEG = process.env.ANN_FFMPEG || (existsSync(
  'C:\\Users\\52332\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe')
  ? 'C:\\Users\\52332\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe'
  : 'ffmpeg');

const FPS = 30;
const DURATION = 12;
const FRAMES = FPS * DURATION;
/* .app is a fixed 1280x760 box: 196 sidebar + main + 392 narration column.
   The narration column is not part of the plugin, so stills crop it away
   instead of hiding it -- hiding would re-flow the main column. */
const WIDTH = 1280;
const HEIGHT = 760;
const STILL_WIDTH = WIDTH - 392;
const PAGE_URL = pathToFileURL(join(here, 'preview.html')).href;

/* the frame -> expectation table. Each entry is a checkpoint the recording has
   to satisfy; a broken plugin fails here rather than producing a plausible but
   wrong animation. */
const CHECKS = [
  { frame: 30,  what: 'shows the toolbar over the selection', test: (s) => assert.equal(s.bar, true) },
  { frame: 82,  what: 'opens the note card',                  test: (s) => assert.equal(s.card, true) },
  { frame: 132, what: 'commits one numbered marker',          test: (s) => assert.equal(s.nums, 1) },
  { frame: 190, what: 'commits a second marker',              test: (s) => assert.equal(s.nums, 2) },
  { frame: 215, what: 'expands the pending list on hover',    test: (s) => assert.ok(s.tip.length > 0) },
  { frame: 320, what: 'collapses the pending list',           test: (s) => assert.equal(s.tip, '') },
  { frame: 290, what: 'sends with only a bubble tag',         test: (s) => assert.ok(s.tag.length > 0) },
  { frame: 350, what: 'turns Annotation labels into chips',   test: (s) => assert.equal(s.replyChips, 2) },
];

const log = (...a) => console.log(...a);
log('capture plan:', `${FRAMES} frames @ ${FPS}fps, ${WIDTH}x${HEIGHT}`);

const temp = await mkdtemp(join(tmpdir(), 'dsh-annotation-demo-'));
const framesDir = join(temp, 'frames');
await mkdir(framesDir, { recursive: true });

log('launching Edge…');
const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--allow-file-access-from-files',
  '--force-device-scale-factor=1',
  '--remote-debugging-port=0',
  `--user-data-dir=${join(temp, 'profile')}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let socket;
try {
  const ws = await new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('Edge did not report a DevTools port in 20s')), 20000);
    edge.stderr.on('data', (chunk) => {
      buffered += chunk;
      const m = buffered.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    edge.on('error', reject);
  });

  socket = new WebSocket(ws);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const slot = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) slot.reject(new Error(JSON.stringify(message.error)));
    else slot.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  });
  await call('Page.navigate', { url: PAGE_URL });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails, null, 1));
    return result.result.value;
  };

  for (let i = 0; i < 100; i++) {
    if (await evaluate('typeof window.demoFrame === "function"')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await evaluate('typeof window.demoFrame'), 'function', 'preview.html did not boot');

  const checks = new Map(CHECKS.map((c) => [c.frame, c]));

  for (let frame = 0; frame < FRAMES; frame++) {
    const t = frame / FPS;
    const state = await evaluate(`window.demoFrame(${t})`);

    const check = checks.get(frame);
    if (check) {
      try { check.test(state); }
      catch (error) { throw new Error(`frame ${frame}: expected it ${check.what}\n  got ${JSON.stringify(state)}\n  ${error.message}`); }
      log(`  ✓ frame ${String(frame).padStart(3)} — ${check.what}`);
    }

    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(framesDir, `${String(frame).padStart(4, '0')}.png`), Buffer.from(shot.data, 'base64'));
    if (frame % 60 === 0) log(`  captured ${frame}/${FRAMES}`);
  }

  /* ---- stills for README: toolbar / markers + pending list / reply chips ----
     cropped straight out of the frames just captured, so a still is always the
     same pixels the animation shows. Replaying the timeline a second time for
     them does not work: the plugin debounces on rAF, and in a headless browser
     those callbacks only run when a frame is actually produced -- the capture
     loop produces one per screenshot, a bare replay produces none. */
  const shots = join(repo, 'docs', 'screenshots');
  await mkdir(shots, { recursive: true });
  const stillAt = async (t, name) => {
    const source = join(framesDir, `${String(Math.round(t * FPS)).padStart(4, '0')}.png`);
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-i', source,
      '-vf', `crop=${STILL_WIDTH}:${HEIGHT}:0:0`,
      join(shots, name),
    ]);
    log(`  still ${name} ← t=${t}s`);
  };
  await stillAt(0.9, '01-toolbar.png');
  await stillAt(7.3, '02-markers.png');
  await stillAt(11.8, '03-reply.png');

  /* ---- encode: mp4 master, then a small gif for the README ---- */
  const images = join(repo, 'docs', 'images');
  await mkdir(images, { recursive: true });
  const mp4 = join(temp, 'demo.mp4');
  const gif = join(images, 'demo.gif');

  log('encoding mp4…');
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-framerate', String(FPS),
    '-i', join(framesDir, '%04d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', '-an',
    mp4,
  ]);

  log('encoding gif…');
  // 12fps keeps the gestures legible while landing well under a megabyte
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-i', mp4,
    '-vf', 'fps=12,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0',
    gif,
  ]);

  const size = (await stat(gif)).size;
  log('');
  log('done');
  log(`  gif    ${gif}  ${(size / 1024).toFixed(0)} KB`);
  log(`  stills ${shots}`);
  if (size > 900 * 1024) log(`  ! gif is ${(size / 1024).toFixed(0)} KB — consider lowering the scale or fps`);
} finally {
  try { socket?.close(); } catch {}
  edge.kill();
  if (!process.env.ANN_KEEP) await rm(temp, { recursive: true, force: true }).catch(() => {});
  else log(`frames kept in ${temp}`);
}
