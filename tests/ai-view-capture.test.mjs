import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
const start = source.indexOf('// BEGIN AI VIEW CAPTURE');
const end = source.indexOf('// END AI VIEW CAPTURE', start);
assert.ok(start >= 0 && end > start, 'the production capture implementation must be available');
const captureSource = source.slice(start, end);
const raster = 'data:image/png;base64,iVBORw0KGgo=';
const svgUrl = (viewBox = '0 0 60 20') => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path d="M 0 0 L 60 20"/></svg>`)}`;

function harness(mode = 'compound', options = {}) {
  const events = [], canvases = [], decoded = [], queried = [];
  const views = Object.fromEntries(['front', 'top', 'side'].map(key => [key, {
    src: svgUrl(), complete: true, naturalWidth: 300, dataset: { projectionSource: 'exact-brep' }
  }]));
  class CaptureImage {
    naturalWidth = options.naturalWidth || 640;
    naturalHeight = options.naturalHeight || 320;
    set src(value) {
      this.source = value;
      decoded.push(value);
      queueMicrotask(() => {
        options.onDecode?.(views, decoded.length);
        if (options.decodeFailure) this.onerror?.(); else this.onload?.();
      });
    }
  }
  class SvgParser {
    parseFromString(xml) {
      const attributes = new Map();
      const viewBox = /viewBox="([^"]*)"/.exec(xml)?.[1];
      if (viewBox !== undefined) attributes.set('viewBox', viewBox);
      const strokeNodes = [...xml.matchAll(/<g\b[^>]*>/g)].map(([tag]) => {
        const values = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
        return { tag, values, getAttribute: name => values.get(name) ?? null, setAttribute: (name, value) => values.set(name, value) };
      });
      return {
        querySelector: () => xml.includes('malformed') ? {} : null,
        documentElement: {
          localName: xml.startsWith('<svg ') ? 'svg' : 'not-svg', xml, attributes, strokeNodes,
          querySelectorAll: () => strokeNodes,
          getAttribute: name => attributes.get(name) ?? null,
          setAttribute: (name, value) => attributes.set(name, value)
        }
      };
    }
  }
  const context = vm.createContext({
    state: { mode }, modelRevision: 7, scene: {}, camera: {},
    renderer: {
      render() { events.push('render-model'); },
      domElement: { toDataURL(type) {
        events.push('read-model');
        assert.equal(type, 'image/jpeg');
        if (options.modelFailure) throw new Error('private-rendering-details');
        return 'data:image/jpeg;base64,/9j/';
      } }
    },
    projectionTargetDataUrl(key) {
      events.push(`target-${key}`);
      if (mode === 'compound') throw new Error('compound capture must not use alternate render targets');
      return options.emptyTarget === key ? '' : raster;
    },
    document: {
      querySelector(selector) {
        queried.push(selector);
        const key = /^\[data-compound-image="(front|top|side)"\]$/.exec(selector)?.[1];
        assert.ok(key, 'only the three compound drawing elements may be read');
        return views[key];
      },
      createElement(tag) {
        assert.equal(tag, 'canvas', 'no page screenshot or settings element is created');
        const operations = [];
        const canvas = {
          width: 0, height: 0, operations,
          getContext(type) {
            assert.equal(type, '2d');
            return {
              set fillStyle(value) { operations.push(['fillStyle', value]); },
              fillRect(...args) { operations.push(['fillRect', ...args]); },
              drawImage(image, ...args) { operations.push(['drawImage', image.source, ...args]); }
            };
          },
          toDataURL(type) { assert.equal(type, 'image/png'); operations.push(['export']); return raster; }
        };
        canvases.push(canvas);
        return canvas;
      }
    },
    DOMParser: SvgParser,
    XMLSerializer: class { serializeToString(svg) {
      let xml = svg.xml.replace('<svg ', `<svg width="${svg.attributes.get('width')}" height="${svg.attributes.get('height')}" `);
      for (const node of svg.strokeNodes) {
        xml = xml.replace(node.tag, node.tag.replace(/([\w-]+)="([^"]*)"/g, (_, key) => `${key}="${node.values.get(key)}"`));
      }
      return xml;
    } },
    Image: CaptureImage, TextDecoder, Uint8Array, atob,
    setTimeout, clearTimeout
  });
  vm.runInContext(captureSource, context);
  return { context, views, events, canvases, decoded, queried, capture: () => context.captureAiImages() };
}

test('explore captures the rendered model immediately, followed by the three current render targets', async () => {
  const h = harness('explore');
  const promise = h.capture();
  assert.equal(typeof promise.then, 'function');
  const images = await promise;
  assert.deepEqual(h.events, ['render-model', 'read-model', 'target-front', 'target-top', 'target-side']);
  assert.equal(images.length, 4);
  assert.match(images[0].dataUrl, /^data:image\/jpeg/);
  assert.ok(images.slice(1).every(image => image.dataUrl === raster));
  assert.deepEqual(h.queried, []);
});

test('compound exports actual exact SVG sources as white PNGs with their viewBox aspect ratios', async () => {
  const h = harness();
  h.views.top.src = svgUrl('-5 -10 20 60');
  h.views.side.src = svgUrl('0 0 40 40');
  const images = await h.capture();
  assert.equal(images.length, 4);
  assert.deepEqual(h.events, ['render-model', 'read-model'], 'no HLR regeneration or alternate render target');
  assert.deepEqual(h.canvases.map(canvas => [canvas.width, canvas.height]), [[1200, 400], [400, 1200], [1200, 1200]]);
  assert.ok(images.slice(1).every(image => /当前精确投影/.test(image.label) && image.dataUrl === raster));
  assert.ok(images.every(image => !/exact-brep|interactive-preview/.test(image.label)));
  h.canvases.forEach(canvas => {
    assert.deepEqual(canvas.operations[0], ['fillStyle', '#fff']);
    assert.deepEqual(canvas.operations[1], ['fillRect', 0, 0, canvas.width, canvas.height]);
    assert.equal(canvas.operations[2][0], 'drawImage');
    const exportedSvg = decodeURIComponent(canvas.operations[2][1].split(',')[1]);
    assert.match(exportedSvg, /<path d="M 0 0 L 60 20"\/>/, 'current displayed SVG paths survive unchanged');
    assert.ok(exportedSvg.includes(`width="${canvas.width}" height="${canvas.height}"`));
    assert.equal(canvas.operations[3][0], 'export');
  });
});

test('compound interactive preview uses the displayed raster and labels its evidence level', async () => {
  const h = harness();
  for (const image of Object.values(h.views)) { image.src = raster; image.dataset.projectionSource = 'interactive-preview'; }
  const images = await h.capture();
  assert.deepEqual(h.decoded, [raster, raster, raster]);
  assert.ok(images.slice(1).every(image => /当前交互预览/.test(image.label) && !/exact-brep|interactive-preview/.test(image.label)));
  assert.deepEqual(h.canvases.map(canvas => [canvas.width, canvas.height]), [[640, 320], [640, 320], [640, 320]]);
});

test('SVG exports preserve UI-relative stroke and dash scale without changing source paths or colors', async () => {
  const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 0 60 20"><g fill="none" stroke="#20384a" stroke-width="1.45" stroke-dasharray="5 3.5"><path d="M 0 0 L 60 20" vector-effect="non-scaling-stroke"/></g></svg>';
  const original = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  for (const [displayWidth, expectedScale] of [[300, 4], [600, 2], [100, 4], [0, 3], [undefined, 3]]) {
    const h = harness();
    for (const image of Object.values(h.views)) {
      image.src = original;
      if (displayWidth !== undefined) image.getBoundingClientRect = () => ({ width: displayWidth });
    }
    await h.capture();
    const exported = decodeURIComponent(h.decoded[0].split(',')[1]);
    assert.ok(exported.includes(`stroke-width="${1.45 * expectedScale}"`));
    assert.ok(exported.includes(`stroke-dasharray="${5 * expectedScale} ${3.5 * expectedScale}"`));
    assert.match(exported, /stroke="#20384a"/);
    assert.match(exported, /viewBox="-5 0 60 20"/);
    assert.match(exported, /<path d="M 0 0 L 60 20" vector-effect="non-scaling-stroke"\/>/);
    assert.deepEqual([h.canvases[0].width, h.canvases[0].height], [1200, 400]);
    assert.ok(Object.values(h.views).every(image => image.src === original && image.dataset.projectionSource === 'exact-brep'));
  }
});

test('missing, loading and invalid sources return readable errors without alternate capture', async () => {
  for (const change of [image => { image.complete = false; }, image => { image.src = ''; }, image => { image.naturalWidth = 0; }]) {
    const h = harness(); change(h.views.front);
    await assert.rejects(h.capture(), /主视图尚未加载完成/);
    assert.equal(h.decoded.length, 0);
  }
  for (const invalid of ['https://example.test/private-view.svg', 'javascript:alert(1)', raster]) {
    const h = harness(); h.views.front.src = invalid;
    await assert.rejects(h.capture(), /主视图的图像来源无效/);
    assert.equal(h.decoded.length, 0);
  }
  const h = harness('explore', { emptyTarget: 'top' });
  await assert.rejects(h.capture(), /俯视图尚未生成/);
});

test('invalid SVG viewBoxes and decode errors never silently replace the displayed source', async () => {
  for (const box of ['0 0 0 20', '0 0 -20 40', '0 0 NaN 20', '0 0 20', '']) {
    const h = harness(); h.views.front.src = svgUrl(box);
    await assert.rejects(h.capture(), /主视图的SVG或viewBox无效/);
  }
  const h = harness('compound', { decodeFailure: true });
  await assert.rejects(h.capture(), /主视图图像无法加载/);
  assert.equal(h.canvases.length, 0);
});

test('capture rejects a changed UI source during asynchronous conversion', async () => {
  const h = harness('compound', { onDecode(views, count) { if (count === 1) views.front.src = svgUrl('0 0 80 20'); } });
  await assert.rejects(h.capture(), /模型或三视图已变化/);
});

test('unsupported modes capture nothing and model canvas failures disclose no internals', async () => {
  const h = harness('vice');
  assert.equal((await h.capture()).length, 0);
  assert.deepEqual(h.events, []);
  await assert.rejects(harness('compound', { modelFailure: true }).capture(), error => {
    assert.match(error.message, /无法读取当前模型画布/);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});
