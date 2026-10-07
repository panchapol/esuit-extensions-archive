const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFile, mkdtemp, rm, mkdir } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensionDir = path.join(root, 'extension');
const hiddenSelector = '[data-fb-sponsored-hider="hidden"]';

test('installed Manifest V3 extension in Chromium', { timeout: 90000 }, async (t) => {
  const profile = await mkdtemp(path.join(tmpdir(), 'fb-sponsored-hider-test-'));
  const fixtureSource = await readFile(path.join(__dirname, 'fixture.html'), 'utf8');
  const fixture = fixtureSource.replace('</body>', `<script>
    requestAnimationFrame(() => {
      window.hiderFirstFrame = {
        adConcealed: ['english', 'thai', 'split', 'reordered', 'reference', 'accessible', 'wrapper'].every(id => {
          const style = getComputedStyle(document.getElementById(id));
          return style.display === 'none' || style.visibility === 'hidden';
        }),
        ordinaryVisible: getComputedStyle(document.getElementById('ordinary')).visibility === 'visible'
      };
    });
  </script></body>`);
  const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage']);
  const extensionId = createHash('sha256').update(extensionDir).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route('https://www.facebook.com/**', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  await context.route('https://web.facebook.com/**', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  let popup;
  let feed;
  let feedId;
  const status = () => popup.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'getStatus' }), feedId);
  const setEnabled = (enabled) => popup.evaluate((enabled) => chrome.storage.local.set({ enabled }), enabled);

  try {
    feed = await context.newPage();
    await feed.goto('https://www.facebook.com/hider-test');
    await feed.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 8);
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await feed.bringToFront();
    feedId = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);

    await t.test('startup stylesheet conceals ads by the first animation frame', async () => {
      await feed.waitForFunction(() => !!window.hiderFirstFrame);
      assert.equal((await feed.evaluate(() => window.hiderFirstFrame)).adConcealed, true);
    });

    await t.test('English, Thai, split, CSS-reordered, referenced Ad, accessible, and wrapped labels', async () => {
      for (const id of ['english', 'thai', 'split', 'reordered', 'reference', 'accessible', 'wrapper']) {
        assert.equal(await feed.locator(`#${id}`).isVisible(), false, id);
      }
      assert.deepEqual(await status(), { enabled: true, preventFlashes: true, contentCount: 0, filtersActive: false, hiddenCount: 8, feedCount: 7, sidebarCount: 1, pendingCount: 0, version: '0.2.0', ready: true });
    });

    await t.test('ordinary posts, author names, comments, shared posts, hidden markers, and lower links stay visible', async () => {
      for (const id of ['ordinary', 'body-link', 'author', 'comment', 'shared', 'invisible', 'partial', 'lower-link', 'reels-unit']) {
        await feed.locator(`#${id}`).waitFor({ state: 'visible', timeout: 2000 });
        assert.equal(await feed.locator(`#${id}`).isVisible(), true, id);
      }
    });

    await t.test('only the Sponsored sidebar section is hidden', async () => {
      assert.equal(await feed.locator('#sidebar').isVisible(), false);
      assert.equal(await feed.locator('#birthdays').isVisible(), true);
      assert.equal(await feed.locator('#contacts').isVisible(), true);
    });

    await t.test('deeply inserted external labels hide nested virtualized feed units', async () => {
      try {
        await feed.evaluate(() => document.getElementById('feed').insertAdjacentHTML('beforeend', '<div id="portal-ad" data-pagelet="FeedUnit_portal"><div data-virtualized="false"><h4>Advertiser</h4><a><span aria-labelledby="portal-ad-label" style="display:inline-block;width:25px;height:16px"></span></a><p data-ad-preview="message">Ad without its referenced label</p></div></div>'));
        await feed.waitForFunction(() => document.getElementById('portal-ad').getAttribute('data-fb-sponsored-hider') === 'pending');
        await feed.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div id="portal-host"><div><div><span id="portal-ad-label" style="display:none">Ad</span></div></div></div>'));
        await feed.waitForFunction(() => document.getElementById('portal-ad').getAttribute('data-fb-sponsored-hider') === 'hidden', null, { timeout: 2000 });
        await feed.evaluate(() => document.getElementById('portal-ad-label').innerHTML = '<span><span><span><span>Yesterday</span></span></span></span>');
        await feed.locator('#portal-ad').waitFor({ state: 'visible', timeout: 2000 });
        await feed.evaluate(() => document.querySelector('#portal-ad-label span span span span').textContent = 'Ad');
        await feed.waitForFunction(() => document.getElementById('portal-ad').getAttribute('data-fb-sponsored-hider') === 'hidden', null, { timeout: 2000 });
      } finally {
        await feed.evaluate(() => { document.getElementById('portal-ad')?.remove(); document.getElementById('portal-host')?.remove(); });
      }
    });

    await t.test('ad slots collapse and stay collapsed through virtualization, then restore recycled ordinary posts', async () => {
      try {
        await feed.evaluate(() => document.getElementById('feed').insertAdjacentHTML('beforeend', '<div id="ad-slot" style="min-height:480px;margin-bottom:30px"><div data-virtualized="false" id="slot-ad"><h4>Advertiser</h4><a>Sponsored</a><p data-ad-preview="message">Ad</p></div></div>'));
        await feed.waitForFunction(() => document.getElementById('slot-ad').getAttribute('data-fb-sponsored-hider') === 'hidden');
        assert.equal(await feed.locator('#ad-slot').evaluate(el => el.getBoundingClientRect().height), 0, 'collapse the outer reserved height, not only the inner ad');
        await feed.evaluate(() => {
          const post = document.getElementById('slot-ad');
          post.setAttribute('data-virtualized', 'true');
          post.style.minHeight = '700px';
          post.innerHTML = '<div hidden></div>';
        });
        await feed.waitForTimeout(1700);
        assert.equal(await feed.locator('#ad-slot').evaluate(el => el.getBoundingClientRect().height), 0, 'off-screen placeholders must not reopen the hidden ad slot');
        assert.equal(await feed.locator('#slot-ad').getAttribute('data-fb-sponsored-hider'), 'hidden');
        await setEnabled(false);
        await feed.locator('#ad-slot').waitFor({ state: 'visible' });
        assert.equal(await feed.locator('#ad-slot').getAttribute('style'), 'min-height:480px;margin-bottom:30px');
        await setEnabled(true);
        await feed.locator('#ad-slot').waitFor({ state: 'hidden' });
        await feed.evaluate(() => {
          const post = document.getElementById('slot-ad');
          post.setAttribute('data-virtualized', 'false');
          post.innerHTML = '<h4>Friend</h4><a>Yesterday</a><p data-ad-preview="message">Reused for an ordinary post</p>';
        });
        await feed.locator('#slot-ad').waitFor({ state: 'visible', timeout: 2000 });
        assert.equal(await feed.locator('#ad-slot').getAttribute('style'), 'min-height:480px;margin-bottom:30px');
        assert.equal(await feed.locator('#slot-ad').evaluate(el => el.style.minHeight), '700px');
      } finally {
        await feed.evaluate(() => document.getElementById('ad-slot')?.remove());
      }
    });

    await t.test('unsupported ordinary layouts recover automatically without losing Reels', async () => {
      await feed.evaluate(() => document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="unsupported-ordinary" role="article"><h4>Friend</h4><p data-ad-preview="message">A post without recognizable timestamp metadata.</p></article>'));
      await feed.waitForFunction(() => document.getElementById('unsupported-ordinary').getAttribute('data-fb-sponsored-hider') === 'pending');
      // Repeated scans must not extend the deadline and permanently blank the feed.
      for (let index = 0; index < 3; index++) await popup.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'rescan' }), feedId);
      await feed.locator('#unsupported-ordinary').waitFor({ state: 'visible', timeout: 2300 });
      assert.equal(await feed.locator('#reels-unit').isVisible(), true);
      assert.equal((await status()).pendingCount, 0);
      await feed.evaluate(() => document.getElementById('unsupported-ordinary').remove());
    });

    await t.test('aged off-screen posts are checked again before their first frame after scrolling into view', async () => {
      try {
        await feed.evaluate(() => document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="scroll-late-ad" role="article" style="margin-top:2500px"><h4>Advertiser</h4><a><span aria-labelledby="scroll-late-label" style="display:inline-block;width:25px;height:16px"></span></a><p data-ad-preview="message">Unresolved off-screen post</p></article>'));
        await feed.locator('#scroll-late-ad').waitFor({ state: 'visible', timeout: 2300 });
        const frames = await feed.evaluate(async () => {
          const post = document.getElementById('scroll-late-ad');
          post.scrollIntoView();
          // The browser's scroll event should refresh expired metadata waiting.
          const start = performance.now();
          setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<div id="scroll-portal"><span id="scroll-late-label" style="display:none">Ad</span></div>'), 250);
          return new Promise(resolve => {
            const frames = [];
            function sample() {
              const style = getComputedStyle(post);
              frames.push(style.display === 'none' || style.visibility === 'hidden');
              if (performance.now() - start < 450) requestAnimationFrame(sample);
              else resolve(frames);
            }
            requestAnimationFrame(sample);
          });
        });
        assert.ok(frames.every(Boolean), 'an expired off-screen approval must not expose an ad when scrolling starts label loading');
      } finally {
        await feed.evaluate(() => { document.getElementById('scroll-late-ad')?.remove(); document.getElementById('scroll-portal')?.remove(); window.scrollTo(0,0); });
        await feed.waitForTimeout(50);
      }
    });

    await t.test('internal sponsorship hides label-free ads before paint and releases timestamp-free ordinary posts', async () => {
      const result = await feed.evaluate(async () => {
        const modules = new Map();
        const calls = [];
        let environmentCalls = 0;
        const react = { jsx: (type, props) => ({ type, props }) };
        function requireModule(name) { return name === 'react' ? react : modules.get(name); }
        const providerRecords = new Map([
          ['provider-ad', { sponsored_data: { __ref: 'provider-sponsorship' } }],
          ['provider-sponsorship', { ad_id: 'provider-ad-id' }],
          ['provider-organic', { sponsored_data: null }]
        ]);
        modules.set('CometRelay', { useRelayEnvironment() {
          environmentCalls++;
          return { getStore: () => ({ getSource: () => ({ get: (id) => providerRecords.get(id) }) }) };
        } });
        window.__d = function (name, dependencies, factory) {
          const module = { exports: {} };
          const exports = {};
          const result = factory(window, requireModule, requireModule, requireModule, module, module.exports, exports);
          modules.set(name, exports.default || module.exports);
          return result;
        };
        const factoryReturn = window.__d('CometFeedUnitErrorBoundary.react', [], function (a, b, c, d, module, e, exports) {
          exports.default = function (props) {
            calls.push(props.feedUnit.__id);
            if (props.fail) throw new Error('original component error');
            return { type: 'article', props: { role: 'article', children: 'Content without a readable timestamp' } };
          };
          return 'factory-return';
        });
        const records = new Map([
          ['data-ad', { sponsored_data: { __ref: 'sponsorship' } }],
          ['sponsorship', { ad_id: 'local-test-ad' }],
          ['data-organic', { sponsored_data: null }]
        ]);
        window.__d('relay-runtime/store/RelayPublishQueue', [], function (a, b, c, d, module) {
          module.exports = class {
            constructor() { this._store = { getSource: () => ({ get: (id) => records.get(id) }) }; }
            run(value) { return value; }
          };
        });
        const Queue = modules.get('relay-runtime/store/RelayPublishQueue');
        const queueReturn = new Queue().run('queue-return');
        const Component = modules.get('CometFeedUnitErrorBoundary.react');
        const unsupported = Component({ feedUnit: { __id: 'unknown' } });
        function render(tree) {
          const element = document.createElement(tree.type);
          for (const [key, value] of Object.entries(tree.props)) {
            if (key === 'children') {
              if (typeof value === 'object') element.appendChild(render(value));
              else element.textContent = value;
            } else element.setAttribute(key, value);
          }
          return element;
        }
        for (const [id, unit] of [
          ['data-direct-ad', { __id: 'direct-ad', sponsored_data: { ad_id: 'direct' } }],
          ['data-direct-organic', { __id: 'direct-organic', sponsored_data: null }],
          ['data-relay-ad', { __id: 'data-ad' }],
          ['data-relay-organic', { __id: 'data-organic' }],
          ['data-provider-ad', { __id: 'provider-ad' }],
          ['data-provider-organic', { __id: 'provider-organic' }]
        ]) {
          const element = render(Component({ feedUnit: unit }));
          element.id = id;
          document.getElementById('feed').appendChild(element);
        }
        let originalError;
        try { Component({ feedUnit: { __id: 'failing' }, fail: true }); } catch (error) { originalError = error.message; }
        const synchronousAdDisplay = getComputedStyle(document.getElementById('data-direct-ad')).display;
        await new Promise(requestAnimationFrame);
        return {
          synchronousAdDisplay, factoryReturn, queueReturn, originalError, calls, environmentCalls,
          unknownUnchanged: unsupported.type === 'article' && !unsupported.props['data-fb-sponsored-hider-data'],
          adDisplays: ['data-direct-ad', 'data-relay-ad', 'data-provider-ad'].map((id) => getComputedStyle(document.getElementById(id)).display),
          ordinaryVisible: ['data-direct-organic', 'data-relay-organic', 'data-provider-organic'].every((id) => getComputedStyle(document.getElementById(id)).visibility === 'visible')
        };
      });
      assert.equal(result.synchronousAdDisplay, 'none', 'rendered sponsorship is hidden even before MutationObserver runs');
      assert.deepEqual(result.adDisplays, ['none', 'none', 'none']);
      assert.equal(result.ordinaryVisible, true);
      assert.equal(result.factoryReturn, 'factory-return');
      assert.equal(result.queueReturn, 'queue-return');
      assert.equal(result.originalError, 'original component error');
      assert.equal(result.unknownUnchanged, true);
      assert.deepEqual(result.calls, ['unknown', 'direct-ad', 'direct-organic', 'data-ad', 'data-organic', 'provider-ad', 'provider-organic', 'failing']);
      assert.equal(result.environmentCalls, 8, 'environment context must be read consistently for every component render');
      assert.equal((await status()).feedCount, 10);
      await setEnabled(false);
      await feed.locator('#data-direct-ad').waitFor({ state: 'visible' });
      await setEnabled(true);
      await feed.locator('#data-direct-ad').waitFor({ state: 'hidden' });
      await feed.evaluate(() => document.getElementById('data-direct-ad').setAttribute('data-fb-sponsored-hider-data', 'ordinary'));
      await feed.locator('#data-direct-ad').waitFor({ state: 'visible' });
      await feed.evaluate(() => ['data-direct-ad', 'data-direct-organic', 'data-relay-ad', 'data-relay-organic', 'data-provider-ad', 'data-provider-organic'].forEach((id) => document.getElementById(id).remove()));
      await feed.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 8);
    });

    await t.test('complete ads are hidden before the next animation frame without delaying ordinary posts', async () => {
      const firstFrame = await feed.evaluate(() => new Promise((resolve) => {
        document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="paint-ad" role="article"><h4>Advertiser</h4><a href="#">Sponsored</a><p data-ad-preview="message">Ad content</p></article><article id="paint-ordinary" role="article"><h4>Friend</h4><a href="#">2 hours ago</a><p data-ad-preview="message">Ordinary content</p></article>');
        const beforeObserver = getComputedStyle(document.getElementById('paint-ad')).visibility;
        requestAnimationFrame(() => resolve({ beforeObserver, ad: getComputedStyle(document.getElementById('paint-ad')).display, ordinary: getComputedStyle(document.getElementById('paint-ordinary')).visibility }));
      }));
      await feed.evaluate(() => { document.getElementById('paint-ad').remove(); document.getElementById('paint-ordinary').remove(); });
      assert.equal(firstFrame.ad, 'none', 'ads should not remain visible for the former 100 ms debounce');
      assert.equal(firstFrame.beforeObserver, 'hidden', 'CSS must conceal unclassified posts synchronously, before the observer runs');
      assert.equal(firstFrame.ordinary, 'visible');
    });

    await t.test('ads with labels delayed beyond 600 ms and recycled organic containers never become visible', async () => {
      const frames = await feed.evaluate(async () => {
        document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="recycled-paint" role="article"><h4>Friend</h4><a href="#">2 hours ago</a><p data-ad-preview="message">Original ordinary post</p></article>');
        await new Promise(requestAnimationFrame);
        const recycled = document.getElementById('recycled-paint');
        const markup = '<h4>Advertiser</h4><a href="#"><span aria-labelledby="very-late-label"><span style="display:inline-block;width:20px;height:16px"></span></span></a><p data-ad-preview="message">Content arrives before its ad label</p>';
        recycled.innerHTML = markup;
        document.getElementById('feed').insertAdjacentHTML('beforeend', `<article id="late-paint" role="article">${markup}</article>`);
        const started = performance.now();
        setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<span id="very-late-label" style="display:none">Ad</span>'), 1000);
        return new Promise((resolve) => {
          const frames = [];
          function sample() {
            frames.push(['late-paint', 'recycled-paint'].map((id) => {
              const style = getComputedStyle(document.getElementById(id));
              return style.display === 'none' || style.visibility === 'hidden';
            }));
            if (performance.now() - started < 1250) requestAnimationFrame(sample);
            else resolve(frames);
          }
          requestAnimationFrame(sample);
        });
      });
      await feed.evaluate(() => { document.getElementById('late-paint').remove(); document.getElementById('recycled-paint').remove(); document.getElementById('very-late-label').remove(); });
      assert.ok(frames.every((frame) => frame.every(Boolean)), 'the old timeout and permanent settled flag must not expose unresolved ads');
    });

    await t.test('incomplete posts wait briefly; the popup can release unchecked posts', async () => {
      const frames = await feed.evaluate(() => new Promise((resolve) => {
        document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="staged-ad" role="article"><h4>Delayed advertiser</h4><a href="#"><span aria-labelledby="delayed-ad-label"><span style="display:inline-block;width:20px;height:16px"></span></span></a><p data-ad-preview="message">Delayed ad content</p></article><article id="unclassified" role="article"><h4>Unknown layout</h4><p data-ad-preview="message">Ordinary post with no timestamp.</p></article>');
        const started = performance.now();
        const frames = [];
        setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<span id="delayed-ad-label" style="display:none">Ad</span>'), 120);
        function sample() {
          const ad = getComputedStyle(document.getElementById('staged-ad'));
          const ordinary = getComputedStyle(document.getElementById('unclassified'));
          frames.push({ elapsed: performance.now() - started, adConcealed: ad.display === 'none' || ad.visibility === 'hidden', ordinaryVisible: ordinary.visibility === 'visible' });
          if (performance.now() - started < 800) requestAnimationFrame(sample);
          else resolve(frames);
        }
        requestAnimationFrame(sample);
      }));
      assert.ok(frames.length > 2);
      assert.ok(frames.every((frame) => frame.adConcealed), 'staged ads must not flash before their referenced label arrives');
      assert.ok(frames.every((frame) => !frame.ordinaryVisible), 'unchecked posts must stay concealed until classified or explicitly released');
      assert.equal((await status()).pendingCount, 1);
      await feed.bringToFront();
      await popup.reload();
      await popup.locator('#prevent-flashes').uncheck();
      await feed.locator('#unclassified').waitFor({ state: 'visible' });
      assert.equal(await feed.locator('#staged-ad').isVisible(), false, 'turning off the gate must retain classified-ad hiding');
      await popup.locator('#prevent-flashes').check();
      await feed.waitForFunction(() => getComputedStyle(document.getElementById('unclassified')).visibility === 'hidden');
      await feed.evaluate(() => { document.getElementById('staged-ad').remove(); document.getElementById('unclassified').remove(); document.getElementById('delayed-ad-label').remove(); });
    });

    await t.test('new posts are hidden; recycled containers and external accessible labels are reclassified', async () => {
      await feed.evaluate(() => {
        document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="new" role="article"><h4>New advertiser</h4><a href="#">Sponsored</a><p data-ad-preview="message">New ad</p></article>');
      });
      await feed.locator('#new').waitFor({ state: 'hidden' });
      await feed.evaluate(() => { document.querySelector('#english > a').textContent = 'Yesterday'; });
      await feed.locator('#english').waitFor({ state: 'visible' });
      await feed.evaluate(() => { document.getElementById('reference-label').textContent = 'Yesterday'; });
      await feed.locator('#reference').waitFor({ state: 'visible' });
      await feed.evaluate(() => { document.getElementById('reference-label').textContent = 'Ad'; });
      await feed.locator('#reference').waitFor({ state: 'hidden' });
      await feed.evaluate(() => document.getElementById('reference-label').remove());
      await feed.waitForFunction(() => document.getElementById('reference').getAttribute('data-fb-sponsored-hider') === 'pending');
      await feed.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<span id="reference-label" style="display:none">Ad</span>'));
      await feed.locator('#reference').waitFor({ state: 'hidden' });
      await feed.evaluate(() => { document.querySelector('#sidebar h3').textContent = 'Other links'; });
      await feed.locator('#sidebar').waitFor({ state: 'visible' });
      await feed.evaluate(() => { document.querySelector('#sidebar h3').textContent = 'Sponsored'; });
      await feed.locator('#sidebar').waitFor({ state: 'hidden' });
      await feed.evaluate(() => document.getElementById('new').remove());
      await feed.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 7);
      assert.equal((await status()).hiddenCount, 7);
    });

    await t.test('disable restores original inline styles and preferences apply across tabs and reloads', async () => {
      await feed.evaluate(() => { document.getElementById('thai').style.color = 'rgb(10, 20, 30)'; });
      const second = await context.newPage();
      await second.goto('https://web.facebook.com/hider-test');
      await second.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 8);
      await setEnabled(false);
      await feed.waitForFunction(() => !document.querySelector('[data-fb-sponsored-hider="hidden"]'));
      await second.waitForFunction(() => !document.querySelector('[data-fb-sponsored-hider="hidden"]'));
      await feed.waitForFunction(() => document.documentElement.getAttribute('data-fb-sponsored-hider-gate') === 'off');
      assert.equal(await feed.locator('#thai').getAttribute('style'), 'color: rgb(10, 20, 30);');
      await second.reload();
      await second.bringToFront();
      await popup.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        for (let attempt = 0; attempt < 50; attempt++) {
          try { if ((await chrome.tabs.sendMessage(tab.id, { type: 'getStatus' })).ready) return; } catch {}
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('Content script did not initialize');
      });
      assert.equal(await second.locator(hiddenSelector).count(), 0);
      assert.equal(await second.locator('#english').isVisible(), true, 'a stored disabled preference must release the startup gate');
      await setEnabled(true);
      await feed.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 7);
      await second.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 8);
      await second.close();
    });

    await t.test('popup displays counts, toggles preferences, and triggers a rescan', async () => {
      await feed.bringToFront();
      await popup.reload();
      await popup.waitForFunction(() => document.getElementById('count').textContent === '7');
      assert.equal(await popup.locator('#enabled').isChecked(), true);
      assert.equal(await popup.locator('#prevent-flashes').isChecked(), true);
      assert.equal(await popup.locator('#version').textContent(), 'v0.2.0');
      await popup.locator('#rescan').click();
      assert.equal((await status()).hiddenCount, 7);
      await popup.locator('#enabled').uncheck();
      await feed.waitForFunction(() => !document.querySelector('[data-fb-sponsored-hider="hidden"]'));
      await popup.locator('#enabled').check();
      await feed.waitForFunction(() => document.querySelectorAll('[data-fb-sponsored-hider="hidden"]').length === 7);
      await mkdir(path.join(root, 'artifacts'), { recursive: true });
      await popup.locator('body').screenshot({ path: path.join(root, 'artifacts', 'popup.png') });
    });

    const filterPosts = [
      ['sport', 'Djokovic tennis racket advice'], ['sport-th', 'กีฬา เทนนิส จีโน่'],
      ['ai', 'Vibe coding with Postgres and vector search'], ['ai-th', 'เขียนโปรแกรมด้วยปัญญาประดิษฐ์'],
      ['crypto', 'Blockchain payments with agent wallets'], ['crypto-th', 'บล็อกเชนและคริปโต'],
      ['news', 'Bangkok flooding and elections'], ['news-th', 'ข่าวด่วน น้ำท่วม'],
      ['entertainment', 'Music concert and funny comedy'], ['entertainment-th', 'เพลง ดนตรี ตลก'],
      ['overlap', 'AI agents using blockchain wallets'],
      ['negative', 'Daily routines and a chair.'],
      ['comment-only', 'My lunch today', '<div data-testid="comments">Tennis, AI, blockchain, breaking news, music</div>'],
      ['hidden-topic', 'My lunch today', '<span style="display:none">Tennis AI blockchain breaking news music</span>'],
      ['photo', 'A lovely view', '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22120%22%3E%3C/svg%3E" alt="A landscape" style="width:200px;height:120px">'],
      ['avatar', 'My lunch today', '<img alt="Profile picture" style="width:200px;height:120px">'],
      ['video', 'A lovely view', '<video width="200" height="120"></video>'],
      ['reel', 'A lovely view', '<a href="/reel/123">Watch reel</a>'],
      ['group', 'My lunch today', '', '<h4><a href="/groups/gardening">Gardening club</a></h4>'],
      ['suggested', 'My lunch today', '', '<span>Suggested for you</span>'],
      ['suggested-th', 'My lunch today', '', '<span>แนะนำสำหรับคุณ</span>'],
      ['source-in-body', 'Suggested for you <a href="/groups/gardening">group link</a>']
    ];
    const filterMarkup = `<section id="filter-fixture">${filterPosts.map(([id, text, extra = '', header = '']) => `<div id="filter-slot-${id}" style="min-height:200px;margin-bottom:20px"><article role="article" id="filter-${id}">${header}<h4>Friend</h4><a>Yesterday</a><p data-ad-preview="message">${text}</p>${extra}</article></div>`).join('')}</section>`;
    const resetFilters = () => popup.evaluate(async () => {
      await chrome.storage.local.set({ ...globalThis.FbContentFilters.defaults, enabled: true });
    });

    await t.test('all five topic switches default off and independently match English/Thai without comment or substring false positives', async () => {
      await feed.evaluate(markup => document.getElementById('feed').insertAdjacentHTML('beforeend', markup), filterMarkup);
      for (const [id] of filterPosts) await feed.locator(`#filter-${id}`).waitFor({ state: 'visible' });
      for (const key of ['hideSports', 'hideAI', 'hideBlockchain', 'hideNews', 'hideEntertainment']) assert.equal(await popup.locator(`#${key}`).isChecked(), false);
      try {
        for (const [key, ids] of [
          ['hideSports', ['sport', 'sport-th']], ['hideAI', ['ai', 'ai-th', 'overlap']],
          ['hideBlockchain', ['crypto', 'crypto-th', 'overlap']], ['hideNews', ['news', 'news-th']],
          ['hideEntertainment', ['entertainment', 'entertainment-th']]
        ]) {
          await popup.locator(`#${key}`).check();
          for (const [id] of filterPosts) {
            try { await feed.locator(`#filter-${id}`).waitFor({ state: ids.includes(id) ? 'hidden' : 'visible', timeout: 3000 }); }
            catch (error) {
              const detail = await feed.locator(`#filter-${id}`).evaluate(el => ({ html: el.outerHTML, children: Array.from(el.querySelectorAll('*')).map(node => ({ tag: node.tagName, display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })) }));
              throw new Error(`${key}: ${id}: ${JSON.stringify(detail)}`, { cause: error });
            }
          }
          assert.equal((await status()).contentCount, ids.length);
          assert.equal((await status()).hiddenCount, 7, 'content filtering does not inflate ad counts');
          await popup.locator(`#${key}`).uncheck();
          for (const id of ids) await feed.locator(`#filter-${id}`).waitFor({ state: 'visible' });
        }
      } finally { await resetFilters(); }
    });

    await t.test('format and source switches distinguish media, avatars, header groups, and suggested labels', async () => {
      try {
        for (const [key, ids] of [
          ['hideVideos', ['video', 'reel']], ['hidePhotos', ['photo']], ['hideReels', ['reel']],
          ['hideGroups', ['group']], ['hideSuggested', ['suggested', 'suggested-th']],
          ['hideTextOnly', filterPosts.map(([id]) => id).filter(id => !['photo', 'video', 'reel'].includes(id))]
        ]) {
          await popup.locator(`#${key}`).check();
          for (const [id] of filterPosts) {
            try { await feed.locator(`#filter-${id}`).waitFor({ state: ids.includes(id) ? 'hidden' : 'visible', timeout: 3000 }); }
            catch (error) {
              const detail = await feed.locator(`#filter-${id}`).evaluate(el => ({ html: el.outerHTML, children: Array.from(el.querySelectorAll('*')).map(node => ({ tag: node.tagName, display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })) }));
              throw new Error(`${key}: ${id}: ${JSON.stringify(detail)}`, { cause: error });
            }
          }
          await popup.locator(`#${key}`).uncheck();
          for (const id of ids) await feed.locator(`#filter-${id}`).waitFor({ state: 'visible' });
        }
        await popup.locator('#hidePhotos').check();
        await feed.locator('#filter-photo').waitFor({ state: 'hidden' });
        let deliverImage;
        await context.route('https://www.facebook.com/delayed-photo.svg', route => new Promise(resolve => {
          deliverImage = async () => {
            await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"></svg>' });
            resolve();
          };
        }));
        await feed.evaluate(() => document.getElementById('filter-fixture').insertAdjacentHTML('beforeend', '<article role="article" id="delayed-photo"><h4>Friend</h4><a>Yesterday</a><p data-ad-preview="message">A view</p><img src="/delayed-photo.svg" style="width:200px;height:auto"></article>'));
        await feed.locator('#delayed-photo').waitFor({ state: 'visible' });
        for (let attempt = 0; !deliverImage && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(deliverImage, 'delayed image request reached the local fixture route');
        await deliverImage();
        await feed.locator('#delayed-photo').waitFor({ state: 'hidden', timeout: 3000 });
        await feed.evaluate(() => document.getElementById('delayed-photo').remove());
      } finally { await resetFilters(); }
    });

    await t.test('content settings persist across tabs independently of ad hiding and restore collapsed or recycled slots', async () => {
      let second;
      try {
        await popup.locator('#hideAI').check();
        await popup.locator('#hideBlockchain').check();
        await setEnabled(false);
        await feed.locator('#thai').waitFor({ state: 'visible' });
        await feed.locator('#filter-overlap').waitFor({ state: 'hidden' });
        await popup.locator('#hideAI').uncheck();
        await feed.locator('#filter-ai').waitFor({ state: 'visible' });
        assert.equal(await feed.locator('#filter-overlap').isVisible(), false, 'remaining matching switch keeps overlap hidden');
        assert.equal(await feed.locator('#filter-slot-crypto').evaluate(el => el.getBoundingClientRect().height), 0);
        await feed.evaluate(() => {
          const post = document.getElementById('filter-crypto');
          post.setAttribute('data-virtualized', 'true');
          post.innerHTML = '<div hidden></div>';
        });
        await popup.evaluate(id => chrome.tabs.sendMessage(id, { type: 'rescan' }), feedId);
        assert.equal(await feed.locator('#filter-slot-crypto').evaluate(el => el.getBoundingClientRect().height), 0);
        await context.route('https://web.facebook.com/content-filter-test', route => route.fulfill({ contentType: 'text/html', body: fixture.replace('</main>', `${filterMarkup}</main>`) }));
        second = await context.newPage();
        await second.goto('https://web.facebook.com/content-filter-test');
        await second.locator('#filter-overlap').waitFor({ state: 'hidden' });
        await second.locator('#english').waitFor({ state: 'visible' });
        await second.reload();
        await second.locator('#filter-overlap').waitFor({ state: 'hidden' });
        await popup.locator('#hideBlockchain').uncheck();
        await feed.locator('#filter-overlap').waitFor({ state: 'visible' });
        await second.locator('#filter-overlap').waitFor({ state: 'visible' });
        assert.equal(await feed.locator('#filter-slot-crypto').getAttribute('style'), 'min-height:200px;margin-bottom:20px');
        assert.equal(await feed.locator('#filter-slot-crypto').evaluate(el => el.getBoundingClientRect().height), 200);
        await popup.locator('#hideSports').check();
        await feed.locator('#filter-sport').waitFor({ state: 'hidden' });
        await feed.evaluate(() => document.querySelector('#filter-sport [data-ad-preview]').textContent = 'My lunch today');
        await feed.locator('#filter-sport').waitFor({ state: 'visible' });
        await popup.reload();
        assert.equal(await popup.locator('#hideSports').isChecked(), true, 'popup reload retains individual setting');
      } finally {
        await second?.close();
        await resetFilters();
        await feed.evaluate(() => document.getElementById('filter-fixture')?.remove());
      }
    });

    await t.test('manual scans do not inflate counts or cause recurring observer loops', async () => {
      const before = await status();
      for (let index = 0; index < 3; index++) {
        await popup.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'rescan' }), feedId);
      }
      assert.deepEqual(await status(), before);
      const mutations = await feed.evaluate(() => new Promise((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => { count += records.length; });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-fb-sponsored-hider'] });
        setTimeout(() => { observer.disconnect(); resolve(count); }, 400);
      }));
      assert.equal(mutations, 0);
      assert.deepEqual(errors, []);
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
