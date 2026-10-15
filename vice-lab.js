const VICE_PAGE = 'assets/vice-lab/index.html';

/** Mount the delivered vice experiment only while its platform tab is active. */
export function createViceLab() {
  const workspace = document.getElementById('workspace');
  if (!workspace) throw new Error('无法找到虎钳实验的工作区。');

  const pageUrl = new URL(VICE_PAGE, document.baseURI).href;
  const shell = document.createElement('section');
  shell.id = 'vice-lab-shell';
  shell.hidden = true;
  shell.setAttribute('aria-label', '虎钳拆装实验');

  const toolbar = document.createElement('div');
  toolbar.className = 'vice-lab-toolbar';

  const information = document.createElement('div');
  information.className = 'vice-lab-information';
  const title = document.createElement('strong');
  title.textContent = '虎钳拆装实验';
  const source = document.createElement('span');
  source.className = 'vice-lab-source';
  source.textContent = '来自虎钳拆装教学网页';
  information.append(title, source);

  const actions = document.createElement('div');
  actions.className = 'vice-lab-actions';
  const resetNote = document.createElement('span');
  resetNote.className = 'vice-lab-reset-note';
  resetNote.textContent = '切换到其他栏目后，再次进入将重新开始。';
  const standalone = document.createElement('a');
  standalone.className = 'vice-lab-open';
  standalone.href = pageUrl;
  standalone.target = '_blank';
  standalone.rel = 'noopener';
  standalone.textContent = '独立打开 ↗';
  standalone.setAttribute('aria-label', '在新窗口独立打开虎钳拆装实验');
  actions.append(resetNote, standalone);
  toolbar.append(information, actions);

  const frameHost = document.createElement('div');
  frameHost.className = 'vice-lab-frame-host';
  const notice = document.createElement('p');
  notice.className = 'vice-lab-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  frameHost.append(notice);
  shell.append(toolbar, frameHost);
  workspace.insertAdjacentElement('afterend', shell);

  let currentFrame = null;

  function enter() {
    shell.hidden = false;
    if (currentFrame) return;

    notice.hidden = false;
    notice.textContent = '正在打开虎钳实验…';
    frameHost.setAttribute('aria-busy', 'true');
    const frame = document.createElement('iframe');
    frame.className = 'vice-lab-frame';
    frame.title = '虎钳实验：夹紧原理、拆装训练与自由取件';
    frame.allow = 'fullscreen';
    frame.allowFullscreen = true;
    currentFrame = frame;
    frame.addEventListener('load', () => {
      if (currentFrame !== frame) return;
      frameHost.setAttribute('aria-busy', 'false');
      if (frame.contentDocument?.getElementById('app')) {
        // The standalone page's short-landscape layout assumes a narrow phone.
        // Embedding leaves less vertical space on desktop, so retain its three rows.
        const layout = frame.contentDocument.createElement('style');
        layout.textContent = '@media (min-width:761px) and (max-height:640px){.lab-shell{grid-template-rows:52px minmax(0,1fr) 102px}}';
        frame.contentDocument.head.append(layout);
        notice.hidden = true;
      } else {
        notice.textContent = '虎钳实验未能打开，请使用上方“独立打开”重试。';
      }
    }, { once: true });
    frame.addEventListener('error', () => {
      if (currentFrame !== frame) return;
      frameHost.setAttribute('aria-busy', 'false');
      notice.textContent = '虎钳实验未能打开，请使用上方“独立打开”重试。';
    }, { once: true });
    frame.src = pageUrl;
    frameHost.append(frame);
  }

  function leave() {
    shell.hidden = true;
    frameHost.setAttribute('aria-busy', 'false');
    const frame = currentFrame;
    currentFrame = null;
    if (frame) {
      // Unload its document so animations and WebGL do not run in a hidden tab.
      frame.src = 'about:blank';
      frame.remove();
    }
    notice.hidden = true;
  }

  return { enter, leave };
}
