import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
