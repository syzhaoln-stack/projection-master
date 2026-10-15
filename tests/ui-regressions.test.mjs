import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const INDEX_HTML = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const PROJECTION_MASTER = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');

test('workspace starts after every ribbon div has been closed', () => {
  const workspaceStart = INDEX_HTML.indexOf('<div id="workspace">');
  assert.ok(workspaceStart > 0, 'workspace markup is missing');

  const markupBeforeWorkspace = INDEX_HTML.slice(0, workspaceStart);
  const divTokens = markupBeforeWorkspace.match(/<div\b[^>]*>|<\/div>/g) || [];
  const depth = divTokens.reduce((currentDepth, token) => currentDepth + (token.startsWith('</') ? -1 : 1), 0);

  assert.equal(depth, 0, 'workspace must not be nested inside the ribbon');
});

test('quiz pointer handler computes the canvas bounds before using them', () => {
  const handlerStart = PROJECTION_MASTER.indexOf("dom.addEventListener('pointerup'");
  const handlerEnd = PROJECTION_MASTER.indexOf('\n  });', handlerStart);
  const handlerSource = PROJECTION_MASTER.slice(handlerStart, handlerEnd);
  const rectDeclaration = handlerSource.indexOf('const rect = dom.getBoundingClientRect();');
  const rectUse = handlerSource.indexOf('handlePracticePointerHit(e, rect)');

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'pointerup handler is missing');
  assert.ok(rectDeclaration >= 0 && rectUse >= 0, 'quiz pointer path is missing');
  assert.ok(rectDeclaration < rectUse, 'rect must be initialized before the quiz pointer path uses it');
});

test('tiled mode mounts the renderer through one host function and updates the text label only', () => {
  assert.match(PROJECTION_MASTER, /function getRendererHost\(\)/);
  assert.match(PROJECTION_MASTER, /function mountRenderer\(\)/);
  assert.match(PROJECTION_MASTER, /button\.querySelector\('\.cap'\)/);
  assert.doesNotMatch(PROJECTION_MASTER, /button\.querySelector\('span'\)\.textContent = enabled/);
  assert.match(PROJECTION_MASTER, /const orientation = VIEW\[key\]/);
  assert.match(PROJECTION_MASTER, /orientation\.flipX \? width - x - 1 : x/);
});

test('spacebar unfolds projections only in free exploration mode', () => {
  assert.match(PROJECTION_MASTER, /e\.code === 'Space' && state\.mode === 'explore'/);
});

test('practice mode snapshots and restores tiled, camera and return mode state', () => {
  assert.match(PROJECTION_MASTER, /function captureProductState\(\)/);
  assert.match(PROJECTION_MASTER, /function applyProductState\(snapshot\)/);
  assert.match(PROJECTION_MASTER, /isTiled: state\.isTiled/);
  assert.match(PROJECTION_MASTER, /cameraPosition: camera\.position\.toArray\(\)/);
  assert.match(PROJECTION_MASTER, /controlsTarget: controls\.target\.toArray\(\)/);
  assert.match(PROJECTION_MASTER, /returnMode: previousMode/);
  assert.match(PROJECTION_MASTER, /if \(returnMode === 'explore' && restoreTiled\) setTiledMode\(true\)/);
});

test('view-alignment assessment keeps visual memory but removes standard-view shortcuts', () => {
  assert.match(INDEX_HTML, /id="quiz-memory-svg"/);
  assert.match(INDEX_HTML, /body\.quiz-rotate-task \.standard-view-actions\{display:none!important;\}/);
  assert.match(PROJECTION_MASTER, /function renderPracticeMemory\(question\)/);
  assert.match(PROJECTION_MASTER, /classList\.toggle\('quiz-rotate-task', question\.type === 'rotate-to-view'/);
  const start = PROJECTION_MASTER.indexOf('function renderPracticeMemory(question) {');
  const end = PROJECTION_MASTER.indexOf('\nfunction renderPracticeQuestion()', start);
  const elements = Object.fromEntries(['quiz-memory', 'quiz-memory-svg', 'quiz-memory-text'].map(id => [id, {
    hidden: false, innerHTML: '', textContent: '', replaceChildren() { this.innerHTML = ''; }
  }]));
  const context = vm.createContext({ document: { getElementById: id => elements[id] } });
  vm.runInContext(PROJECTION_MASTER.slice(start, end), context);
  for (const bridge of [false, true]) {
    for (const targetView of ['front', 'top', 'side']) {
      context.renderPracticeMemory({ id: bridge ? 'bridge-rotate' : 'rotate-to-front', type: 'rotate-to-view', targetView });
      const svg = elements['quiz-memory-svg'].innerHTML;
      assert.match(svg, bridge ? /x 纵桥/ : /x 长度/);
      assert.match(svg, bridge ? /<text x="64" y="15"[^>]*>z 竖向</ : /<text x="64" y="15"[^>]*>y 高度</);
      assert.match(svg, bridge ? /<text x="9" y="87"[^>]*>y 横桥</ : /<text x="9" y="87"[^>]*>z 深度</);
      assert.match(elements['quiz-memory-text'].textContent, bridge ? /再换一种桥或另一张视图/ : /再换一个构件或另一张视图/);
      const lines = [...svg.matchAll(/<line[^>]+>/g)].map(match => match[0]);
      const activeLine = targetView === 'side' ? 0 : targetView === 'top' ? 2 : 1;
      assert.match(lines[activeLine], /stroke-width="4"/);
      assert.equal(lines.filter(line => line.includes('stroke-width="4"')).length, 1);
    }
  }
});

test('textbook lab is an independent mode that reuses the single renderer canvas', () => {
  assert.match(INDEX_HTML, /data-mode="lab"/);
  assert.match(INDEX_HTML, /id="lab-shell"/);
  assert.match(INDEX_HTML, /data-lab-lesson="point"/);
  assert.match(INDEX_HTML, /data-lab-lesson="line"/);
  assert.match(INDEX_HTML, /data-lab-lesson="plane"/);
  assert.match(PROJECTION_MASTER, /createBasicProjectionLab/);
  assert.match(PROJECTION_MASTER, /state\.mode === 'lab'.*lab-canvas-host/);
  assert.match(PROJECTION_MASTER, /setProductEnvironmentVisible\(false\)/);
});
