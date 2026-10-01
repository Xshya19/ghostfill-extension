// Minimal DOM check for the persistent announcement and tooltip cleanup.
// Run: node scripts/check-ui-feedback.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'SVGElement',
  'Element',
  'DOMParser',
  'Node',
  'NodeFilter',
  'customElements',
]) {
  globalThis[key] = dom.window[key];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia = () => ({
  matches: true,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});

function loadSource(source, filename, resolve = require) {
  const result = { exports: {} };
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(resolve, result, result.exports);
  return result.exports;
}

const React = require('react');
const { createRoot } = require('react-dom/client');
const { flushSync } = require('react-dom');
const { Toast } = loadSource(fs.readFileSync('src/frontend/ui/index.tsx', 'utf8'), 'index.tsx');
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(React.createElement(Toast, { message: null })));
const region = document.querySelector('[role="status"]');
assert.ok(region, 'Live region must exist before feedback arrives');
flushSync(() => root.render(React.createElement(Toast, { message: 'Code copied' })));
assert.equal(document.querySelector('[role="status"]'), region);
assert.equal(region.textContent, 'Code copied');
assert.equal(
  document.querySelector('.gf-toast').closest('[aria-hidden]').getAttribute('aria-hidden'),
  'true'
);
const firstAnnouncement = region.firstChild;
flushSync(() => root.render(React.createElement(Toast, { message: 'Code copied', revision: 2 })));
assert.notEqual(
  region.firstChild,
  firstAnnouncement,
  'Repeated feedback must produce a fresh announcement'
);
assert.equal(document.querySelectorAll('.gf-toast').length, 1, 'Feedback must update one capsule');
assert.equal(
  document.querySelector('.gf-toast').style.transform,
  'none',
  'Reduced motion removes toast travel'
);
flushSync(() => root.render(React.createElement(Toast, { message: null })));
assert.equal(document.querySelector('[role="status"]'), region);
assert.equal(region.textContent, '');
flushSync(() => root.unmount());

const coreSource = ts.createSourceFile(
  'core.ts',
  fs.readFileSync('src/utils/core.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const webValidator = coreSource.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'isWebUrl'
);
const { isWebUrl } = loadSource(webValidator.getText(coreSource), 'web-url.ts');
const extractionUtils = loadSource(
  fs.readFileSync('src/services/utils/extraction.utils.ts', 'utf8'),
  'extraction.utils.ts',
  () => ({})
);
const { extractUrls } = loadSource(
  fs.readFileSync('src/services/extraction/urlExtractor.ts', 'utf8'),
  'urlExtractor.ts',
  (name) =>
    name.includes('logger') ? { createLogger: () => ({ debug() {}, warn() {} }) } : extractionUtils
);

const linkSource = ts.createSourceFile(
  'linkService.ts',
  fs.readFileSync('src/services/linkService.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const linkClass = linkSource.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'LinkService'
);
const validator = linkClass.members
  .find((node) => node.name?.getText() === 'validateUrl')
  .getText(linkSource);
const makeLinkProbe = loadSource(
  `module.exports = function() { class Probe { ${validator} } return new Probe(); };`,
  'link-probe.ts'
);
const linkProbe = makeLinkProbe();
assert.equal(
  linkProbe.validateUrl('https://img.alicdn.com').safe,
  true,
  'No activation classification gate for HTTP links'
);
assert.equal(linkProbe.validateUrl('https://example.com/opaque/123').safe, true);
assert.equal(linkProbe.validateUrl('javascript:alert(1)').safe, false);

const readerSource = ts.createSourceFile(
  'SharedComponents.tsx',
  fs.readFileSync('src/frontend/popup/components/SharedComponents.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
let detectorBody;
function findDetector(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText() === 'fallbackDetection') {
    detectorBody = node.initializer.arguments[0].body.getText().slice(1, -1);
  }
  ts.forEachChild(node, findDetector);
}
findDetector(readerSource);
const normalizerNode = readerSource.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => Array.from(statement.declarationList.declarations))
  .find((declaration) => declaration.name.getText() === 'normalizePlainText');
const normalizeText = loadSource(
  `const ${normalizerNode.getText(readerSource)}; module.exports = normalizePlainText;`,
  'normalize.ts'
);
assert.equal(
  normalizeText('Your sign-in code\r\n \t \r\n\u00a0\r\n\r\nHi,\n\n052330'),
  'Your sign-in code\n\nHi,\n\n052330',
  'Whitespace-only MIME spacer lines must not become empty screens'
);
assert.equal(normalizeText('Instructions\n  indented text'), 'Instructions\n  indented text');
assert.ok(detectorBody, 'Check the real reader fallback');
const makeDetector = loadSource(
  `module.exports = function(contentToString, isWebUrl, extractUrls) { return function(plainTextBody, snippet, rawHtml, message) { ${detectorBody} }; };`,
  'detector.ts'
);
const detect = makeDetector(String, isWebUrl, extractUrls);
assert.deepEqual(
  detect(
    'Your sign-in code\n192123',
    '',
    '<img src="https://img.alicdn.com/mail-artwork"><img src="https://cdn.example/logo.png">'
  ),
  { otp: '192123', link: null }
);
assert.deepEqual(
  detect('Your sign-in code\n[https://img.alicdn.com/logo.png]\n700111', '', '', {
    link: 'https://img.alicdn.com/logo.png',
  }),
  { otp: '700111', link: null },
  'Plain MIME image references and previously extracted artwork must not become verification links'
);
assert.equal(
  detect(
    'Use this link to verify your email',
    '',
    '<a href="https://example.com/opaque/action">Verify email</a>'
  ).link,
  'https://example.com/opaque/action'
);
const { getSenderLabel } = loadSource(
  fs.readFileSync('src/utils/emailIdentity.ts', 'utf8'),
  'identity.ts'
);
assert.equal(getSenderLabel('Unknown Sender'), 'Unknown sender');
assert.equal(getSenderLabel('Qwen <no-reply@qwen.ai>'), 'Qwen');

const { IconSystem } = loadSource(fs.readFileSync('src/shared/icons.ts', 'utf8'), 'icons.ts');
assert.match(IconSystem.getSpinner(), /class="gf-loading-spinner"/);
assert.doesNotMatch(IconSystem.getSpinner(), /<animate/);

const source = ts.createSourceFile(
  'floatingButton.ts',
  fs.readFileSync('src/content/floatingButton.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const buttonClass = source.statements.find(
  (node) =>
    ts.isClassDeclaration(node) && node.members.some((m) => m.name?.getText() === 'hideTooltip')
);
const methods = [
  'hideTooltip',
  'showStatusTooltip',
  'positionTooltip',
  'clearStatusTooltip',
  'setupEventListeners',
].map((name) => buttonClass.members.find((m) => m.name?.getText() === name).getText(source));
const Probe = loadSource(
  `class Probe { ${methods.join('\n')} } module.exports = Probe;`,
  'probe.ts'
);
const probe = new Probe();
probe.cleanupFns = [];
probe.tooltip = document.createElement('div');
probe.tooltip.getBoundingClientRect = () => ({ left: -60, right: 120, top: -5 });
probe.showStatusTooltip('Code filled', 'green');
assert.equal(probe.tooltip.style.getPropertyValue('--gf-tooltip-shift'), '68px');
assert.equal(probe.tooltip.style.bottom, 'auto', 'Top-edge tooltips must open below the control');
assert.equal(probe.tooltip.style.backgroundColor, '');
assert.equal(probe.tooltip.style.color, '');
assert.equal(probe.tooltip.style.borderColor, 'green');
assert.equal(probe.tooltip.getAttribute('aria-live'), 'polite');
probe.showStatusTooltip('Fill failed', 'red', 'alert');
assert.equal(probe.tooltip.getAttribute('aria-live'), 'assertive');
probe.clearStatusTooltip();
assert.equal(probe.tooltip.style.borderColor, '');
assert.equal(probe.tooltip.getAttribute('role'), 'tooltip');
assert.equal(probe.tooltip.getAttribute('aria-live'), null);
probe.tooltip.className = 'gf-tooltip-visible';
probe.tooltipTimeout = setTimeout(() => {}, 1000);
probe.setupEventListeners();
window.dispatchEvent(new dom.window.Event('scroll'));
assert.equal(probe.tooltipTimeout, null);
assert.equal(probe.tooltip.classList.contains('gf-tooltip-visible'), false);
probe.tooltip.className = 'gf-tooltip-visible';
window.dispatchEvent(new dom.window.Event('resize'));
assert.equal(probe.tooltip.classList.contains('gf-tooltip-visible'), false);
probe.cleanupFns.forEach((cleanup) => cleanup());
probe.tooltip.className = 'gf-tooltip-visible';
window.dispatchEvent(new dom.window.Event('scroll'));
assert.equal(probe.tooltip.classList.contains('gf-tooltip-visible'), true, 'Listeners must detach');
async function checkPageFeedback() {
  const listeners = new Set();
  let darkMode = false;
  const theme = loadSource(fs.readFileSync('src/shared/theme.ts', 'utf8'), 'theme.ts', (name) => {
    if (name.includes('storageService')) {
      return {
        storageService: {
          getSettings: () => Promise.resolve({ darkMode }),
          onChanged: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      };
    }
    if (name.includes('storage.types')) {
      return { DEFAULT_SETTINGS: { darkMode: false }, STORAGE_KEYS: { SETTINGS: 'settings' } };
    }
    return require(name);
  });
  const resolve = (name) => {
    if (name.includes('theme')) {
      return theme;
    }
    if (name.includes('sanitization')) {
      return {
        setHTML: (element, markup) => {
          element.innerHTML = markup;
        },
      };
    }
    if (name.includes('fieldClassifier')) {
      return { getFieldTooltip: () => 'Fill with GhostFill' };
    }
    if (name.includes('/fab')) {
      return { evaluateFab: () => ({ presence: 'active' }) };
    }
    return require(name);
  };
  const { pageStatus } = loadSource(
    fs.readFileSync('src/content/ui/pageStatus.ts', 'utf8'),
    'pageStatus.ts',
    resolve
  );
  const original = { setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame };
  const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  const timers = new Map();
  const delays = new Map();
  const frames = new Map();
  let sequence = 0;
  let now = 0;
  let hidden = false;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  globalThis.chrome = { runtime: { id: 'check' } };
  globalThis.setTimeout = (callback, delay) => {
    const id = ++sequence;
    timers.set(id, callback);
    delays.set(id, delay);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
    delays.delete(id);
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const announce = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  try {
    pageStatus.success('Code filled');
    const host = document.getElementById('ghostfill-status-container');
    assert.ok(host);
    assert.equal(host.getAttribute('data-theme'), 'light');
    const symbols = [...pageStatus.banner.querySelectorAll('.status-symbol')];
    assert.equal(symbols.length, 3);
    assert.equal(new Set(symbols.map((symbol) => symbol.getAttribute('d'))).size, 3);
    const region = pageStatus.liveRegion;
    announce();
    assert.equal(region.textContent, 'Code filled');
    const child = region.firstChild;
    pageStatus.success('Code filled');
    announce();
    assert.notEqual(region.firstChild, child, 'Repeated feedback must announce a fresh child');
    assert.equal(document.querySelectorAll('#ghostfill-status-container').length, 1);
    assert.equal(timers.size, 1, 'A newer notification cancels the old dismiss timer');

    now += 1000;
    hidden = true;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(timers.size, 0, 'Hidden tabs must pause notification reading time');
    now += 10000;
    hidden = false;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal([...delays.values()][0], 2500, 'Returning resumes the remaining reading time');

    const pointer = (type, pointerType = 'mouse') => {
      const event = new dom.window.Event(type);
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      pageStatus.banner.dispatchEvent(event);
    };
    pointer('pointerenter');
    assert.equal(timers.size, 0, 'Hovering pauses the dismiss timer');
    const dismiss = pageStatus.banner.querySelector('button');
    dismiss.focus();
    pointer('pointerleave');
    assert.equal(timers.size, 0, 'Leaving hover must not restart a keyboard-focused notification');
    now += 10000;
    dismiss.blur();
    assert.equal([...delays.values()][0], 2500, 'Focus pauses without resetting reading time');
    now += 500;
    pointer('pointerenter', 'touch');
    pointer('pointerleave', 'touch');
    assert.equal(timers.size, 1, 'A touch must not leave feedback permanently paused');
    pointer('pointerenter');
    pointer('pointerenter', 'touch');
    pointer('pointerleave', 'touch');
    assert.equal(timers.size, 0, 'Touch input must not cancel an existing mouse hover pause');
    pointer('pointerleave');
    assert.equal([...delays.values()][0], 2000, 'Only visible reading time counts toward expiry');

    hidden = true;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    pageStatus.error('Try again');
    assert.equal(timers.size, 0, 'New background feedback waits for a visible tab');
    now += 10000;
    hidden = false;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.equal(
      [...delays.values()][0],
      5000,
      'Replacement feedback owns its full reading allowance'
    );
    dismiss.click();
    assert.equal(pageStatus.getIsVisible(), false);
    pointer('pointerleave');
    assert.equal(timers.size, 0, 'Dismissed feedback must not restart on pointer leave');

    pageStatus.success('Code filled');
    [...timers.values()][0]();
    assert.equal(pageStatus.getIsVisible(), false, 'Visible, unattended feedback still expires');
    pageStatus.success('Code filled');
    pageStatus.show('Filling form…');
    assert.equal(timers.size, 0, 'Old success timers must not hide newer progress');
    assert.equal(pageStatus.getIsVisible(), true);
    const styles =
      host.shadowRoot === null && pageStatus.banner.parentNode.querySelector('style').textContent;
    assert.match(styles, /prefers-reduced-motion/);
    assert.match(styles, /prefers-reduced-transparency/);
    assert.match(styles, /--gf-ink-soft: #60646c/);
    loadSource(fs.readFileSync('src/content/ui/GhostLabel.ts', 'utf8'), 'GhostLabel.ts', resolve);
    const label = document.createElement('ghost-label');
    document.body.appendChild(label);
    const childCount = label.shadowRoot.childElementCount;
    assert.equal(label.getAttribute('data-theme'), 'light');
    label.remove();
    document.body.appendChild(label);
    assert.equal(
      label.shadowRoot.childElementCount,
      childCount,
      'Reconnected labels must not duplicate controls'
    );
    darkMode = true;
    listeners.forEach((listener) => listener({ settings: {} }));
    await Promise.resolve();
    assert.equal(host.getAttribute('data-theme'), 'dark');
    assert.equal(label.getAttribute('data-theme'), 'dark');
    label.remove();

    const buttonSource = fs.readFileSync('src/content/floatingButton.ts', 'utf8');
    const touchStart = buttonSource.indexOf('let longPressTimer:');
    const touchEnd = buttonSource.indexOf('// ── Hover', touchStart);
    assert.ok(touchStart > 0 && touchEnd > touchStart);
    const TouchProbe = loadSource(
      `const TIMING_MS = { LONG_PRESS: 450 }; class TouchProbe { setup() { ${buttonSource.slice(touchStart, touchEnd)} } } module.exports = TouchProbe;`,
      'touch.ts'
    );
    const touch = new TouchProbe();
    touch.button = document.createElement('button');
    touch.cleanupFns = [];
    touch.setState = (state) => {
      touch.state = state;
    };
    touch.setup();
    const sendTouch = (type, x, y) => {
      const event = new dom.window.Event(type, { cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
      touch.button.dispatchEvent(event);
      return event;
    };
    sendTouch('touchstart', 20, 20);
    sendTouch('touchmove', 21, 21);
    assert.equal(timers.size, 1, 'Small finger movement must preserve the long press');
    [...timers.values()][0]();
    timers.clear();
    assert.equal(touch.state, 'menu-open');
    assert.equal(
      sendTouch('touchend', 21, 21).defaultPrevented,
      true,
      'Long press must suppress the following tap'
    );
    sendTouch('touchstart', 20, 20);
    sendTouch('touchmove', 30, 20);
    assert.equal(timers.size, 0, 'A real drag cancels the long press');
    touch.cleanupFns.forEach((cleanup) => cleanup());
    window.dispatchEvent(new dom.window.Event('pagehide'));
    assert.equal(document.getElementById('ghostfill-status-container'), null);
    assert.equal(listeners.size, 0, 'In-page UI must detach theme subscriptions');
  } finally {
    Object.assign(globalThis, original);
    if (originalNow) Object.defineProperty(performance, 'now', originalNow);
    else delete performance.now;
    if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
    else delete document.hidden;
  }
}
checkPageFeedback()
  .then(() => {
    dom.window.close();
    console.log(
      'UI check passed: reader spacing, shared themed feedback, repeated announcements, visible reading time, timer ownership, tooltip bounds, long press, and existing link checks.'
    );
  })
  .catch((error) => {
    dom.window.close();
    console.error(error);
    process.exitCode = 1;
  });
