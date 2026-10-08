import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const articleUrl = base + '/articles/gtao/';
const results = [], failures = [], browserErrors = [];
await mkdir('test-results', {recursive: true});
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
page.setDefaultTimeout(30000);

function observeErrors(target) {
  target.on('pageerror', error => browserErrors.push({url: target.url(), message: error.message}));
  target.on('console', message => {
    if (message.type() === 'error') browserErrors.push({url: target.url(), message: message.text()});
  });
}
observeErrors(page);

// client:visible first exposes SSR inputs. Always await the island, not merely
// the existence of a range input, before sending an interaction to React.
async function hydrated(target, selector) {
  const region = target.locator(selector);
  await region.scrollIntoViewIfNeeded();
  await target.waitForFunction(selector => {
    const region = document.querySelector(selector);
    const island = region?.closest('astro-island');
    return region && island && !island.hasAttribute('ssr');
  }, selector);
  return region;
}

async function labReady(target, selector = '.ao-lab') {
  const region = await hydrated(target, selector);
  await region.locator('.viewport > canvas').waitFor();
  await target.waitForFunction(selector => !document.querySelector(selector + ' .fallback'), selector);
  return region;
}

async function noHorizontalOverflow(target) {
  const layout = await target.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll('body *')).filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.right > innerWidth + 1 || box.left < -1);
    }).slice(0, 12).map(element => ({tag: element.tagName, className: element.getAttribute('class')})),
  }));
  assert.ok(layout.width <= layout.viewport + 1, JSON.stringify(layout));
  return layout;
}

async function scenario(name, run) {
  try {
    const detail = await run();
    results.push({name, detail});
    console.log('PASS', name);
  } catch (error) {
    failures.push({name, error: error.stack || String(error)});
    console.error('FAIL', name, error.message);
    await page.screenshot({path: `test-results/learning-failure-${failures.length}.png`, fullPage: false}).catch(() => {});
  }
}

try {
  await page.goto(articleUrl);
  await scenario('contact profile exposes only lift and no-AO controls', async () => {
    assert.equal(await page.locator('article > h2').count(), 8);
    assert.equal(await page.locator('article .ao-lab').count(), 2);
    const contact = await labReady(page, '[data-profile="contact"]');
    assert.equal(await contact.locator('.algorithm-tabs, .budget-control, .advanced-controls, .lesson-tabs').count(), 0);
    assert.equal(await contact.getByRole('button', {name: '算法对照', exact: true}).count(), 0);
    assert.equal(await contact.locator('input[type="range"]').count(), 1);
    assert.equal(await contact.locator('.inspection').count(), 0);
    const lift = contact.getByLabel('遮挡物抬升', {exact: true});
    const before = await contact.locator('.viewport > canvas').screenshot();
    await lift.fill('1.1');
    await page.waitForFunction(() => document.querySelector('[data-profile="contact"] label output')?.textContent === '1.10');
    const after = await contact.locator('.viewport > canvas').screenshot();
    assert.notDeepEqual(after, before, 'Lifting the geometry must change the rendered scene.');
    const noAO = contact.getByRole('button', {name: '无 AO', exact: true});
    await noAO.click();
    assert.equal(await noAO.getAttribute('aria-pressed'), 'true');
    await noAO.click();
    assert.equal(await noAO.getAttribute('aria-pressed'), 'false');
    await contact.getByRole('button', {name:'恢复本节示例',exact:true}).click();
    assert.equal(await lift.inputValue(),'0');
    await contact.screenshot({path: 'test-results/learning-contact.png'});
    return {lift: await lift.inputValue(), profiles: 2};
  });

  await scenario('sampling profile follows actual SSAO samples without algorithm controls', async () => {
    const sampling = await labReady(page, '[data-profile="sampling"]');
    assert.match(await sampling.locator('.profile-purpose').innerText(), /SSAO/);
    assert.equal(await sampling.locator('.algorithm-tabs, .advanced-controls, .lesson-tabs').count(), 0);
    assert.equal(await sampling.getByLabel('遮挡物抬升', {exact: true}).count(), 0);
    assert.equal(await sampling.getByRole('button', {name: '算法对照', exact: true}).count(), 0);
    await sampling.getByRole('button', {name: '检查推荐表面', exact: true}).click();
    await sampling.locator('.inspection').waitFor();
    const sample = sampling.getByLabel('检查样本', {exact: true});
    const count = Number(await sample.getAttribute('max')) + 1;
    assert.equal(count, 8);
    const observations = [];
    for (let i = 0; i < count; i++) {
      await sample.fill(String(i));
      await page.waitForFunction(index => document.querySelector('[data-profile="sampling"] .sample-navigation label:last-child output')?.textContent?.startsWith(String(index + 1) + ' /'), i);
      const data = await sampling.locator('.sample-data').innerText();
      const verdict = await sampling.locator('.depth-verdict').count() ? await sampling.locator('.depth-verdict').innerText() : null;
      observations.push({sample: i + 1, data, verdict});
      if (verdict?.includes('候选点落在深度表面之后')) {
        const values = verdict.match(/s\.z = (-?[\d.]+)，q\.z = (-?[\d.]+)/);
        assert.ok(values, verdict);
        assert.ok(Number(values[1]) >= Number(values[2]) + .010, verdict);
      }
    }
    assert.ok(new Set(observations.map(item => item.data)).size > 1, 'Selecting different samples must expose different GPU sample data.');
    assert.ok(observations.some(item => item.verdict), 'At least one sample must expose real q and s depth values.');
    const space = sampling.locator('.sample-space svg');
    const geometryBefore = await space.locator('line').evaluateAll(lines => lines.map(line => line.getAttribute('x2')));
    await sampling.getByLabel('样本空间方位', {exact: true}).fill('45');
    const geometryAfter = await space.locator('line').evaluateAll(lines => lines.map(line => line.getAttribute('x2')));
    assert.notDeepEqual(geometryAfter, geometryBefore);
    await sampling.getByRole('button', {name: '48 次', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-profile="sampling"] input[aria-label="检查切片"]')?.getAttribute('max') === '3');
    assert.equal(await sample.getAttribute('max'), '11');
    await sampling.screenshot({path: 'test-results/learning-sampling.png'});
    return {initialSamples: count, observations};
  });

  await scenario('fixed visible domain changes cosine contribution and agrees with numerical integration', async () => {
    const contribution = await hydrated(page, '.contribution-experiment');
    const domain = await contribution.locator('svg').first().locator('polygon').first().getAttribute('points');
    const readouts = async () => (await contribution.locator('.contribution-readouts dd').allTextContents()).map(Number);
    await contribution.getByRole('button', {name: /背离开口/}).click();
    const away = await readouts();
    await contribution.getByRole('button', {name: /朝向开口/}).click();
    const toward = await readouts();
    assert.equal(toward[0], away[0]);
    assert.ok(toward[1] > away[1] * 5);
    assert.equal(await contribution.locator('svg').first().locator('polygon').first().getAttribute('points'), domain);
    await contribution.getByRole('button', {name: /投影减半/}).click();
    const half = await readouts();
    assert.equal(half[0], away[0]);
    assert.ok(Math.abs(half[1] * 2 - toward[1]) < .000002);
    for (const values of [away, toward, half]) assert.ok(Math.abs(values[1] - values[2]) < .000002);
    await contribution.getByLabel('贡献实验法线偏角', {exact: true}).fill('75');
    const rotated = await readouts();
    assert.equal(rotated[0], away[0]);
    assert.ok(Math.abs(rotated[1] - rotated[2]) < .000002);
    assert.notEqual(rotated[1], half[1]);
    await contribution.screenshot({path: 'test-results/learning-contribution.png'});
    return {away, toward, half, rotated};
  });

  await scenario('deep slice diagram retains its full domain at 75 and 180 degree extremes', async () => {
    await page.getByText('深入推导：从法线投影到解析切片积分', {exact: true}).click();
    const slice = await hydrated(page, 'article > details .slice-experiment');
    const ranges = slice.locator('.diagram-controls input[type="range"]');
    await ranges.nth(0).fill('75');
    await ranges.nth(1).fill('180');
    await ranges.nth(2).fill('180');
    assert.deepEqual(await slice.locator('output').allTextContents(), ['75°', '180°', '180°']);
    const geometry = await slice.locator('svg').evaluate(svg => {
      const box = svg.getBBox(), view = svg.viewBox.baseVal;
      const polygon = svg.querySelector('polygon').getBBox();
      return {bounds: {x: box.x, y: box.y, width: box.width, height: box.height}, view: {x: view.x, y: view.y, width: view.width, height: view.height}, polygonBottom: polygon.y + polygon.height};
    });
    assert.ok(geometry.polygonBottom > 300, 'The visible polygon must include the lower half of the slice.');
    assert.ok(geometry.bounds.x >= geometry.view.x && geometry.bounds.y >= geometry.view.y);
    assert.ok(geometry.bounds.x + geometry.bounds.width <= geometry.view.x + geometry.view.width);
    assert.ok(geometry.bounds.y + geometry.bounds.height <= geometry.view.y + geometry.view.height);
    const integrals = (await slice.locator('.numbers strong').allTextContents()).map(Number);
    assert.ok(Math.abs(integrals[0] - integrals[1]) < .000002);
    await slice.screenshot({path: 'test-results/learning-slice-full-domain.png'});
    return {geometry, integrals};
  });

  await scenario('article lab links preserve the learning task and return chapter', async () => {
    const entrypoints = [
      {selector: '[data-profile="contact"] .lab-bottom a', chapter: 'contact', lesson: 'contact', title: '接触与距离'},
      {selector: '[data-profile="sampling"] .lab-bottom a', chapter: 'ssao', lesson: 'noise', title: '样本与噪声'},
      {selector: '.experiment-link', text: '延伸验证：薄板下面的空隙去了哪里？', chapter: 'horizon', lesson: 'thin', title: '薄板反例'},
      {selector: '.experiment-link', text: '进入完整实验室：用室内阅读角验证整条思路', chapter: 'limits', lesson: 'room', title: '实际应用'},
    ];
    const restored = [];
    for (const entry of entrypoints) {
      await page.goto(articleUrl);
      let link = page.locator(entry.selector);
      if (entry.text) link = link.filter({hasText: entry.text});
      const href = await link.getAttribute('href');
      const state = JSON.parse(decodeURIComponent(new URL(href, base).hash.slice('#state='.length)));
      assert.deepEqual(state.learning, {chapter: entry.chapter, lesson: entry.lesson});
      await link.click();
      await page.waitForURL('**/lab/**');
      const lab = await labReady(page);
      assert.match(await lab.locator('.learning-context').innerText(), new RegExp(entry.title));
      assert.equal(await lab.locator('.learning-context a').getAttribute('href'), '/articles/gtao/#' + entry.chapter);
      assert.equal(await lab.locator('.lab-bottom a').getAttribute('href'), '/articles/gtao/#' + entry.chapter);
      assert.equal(await lab.locator('.lesson-tabs button[aria-pressed="true"]').count(), 1);
      assert.match(await lab.locator('.lesson-tabs button[aria-pressed="true"]').innerText(), new RegExp(entry.title));
      restored.push({chapter: entry.chapter, lesson: entry.lesson, scene: state.scene});
      await lab.locator('.learning-context a').click();
      await page.waitForURL('**/articles/gtao/#' + entry.chapter);
    }
    return restored;
  });

  await scenario('hydrated article and lab remain within a 390px viewport', async () => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(articleUrl);
    await labReady(page, '[data-profile="contact"]');
    await labReady(page, '[data-profile="sampling"]');
    await hydrated(page, '.contribution-experiment');
    await page.getByText('深入推导：从法线投影到解析切片积分', {exact: true}).click();
    await hydrated(page, 'article > details .slice-experiment');
    const article = await noHorizontalOverflow(page);
    await page.locator('.contribution-experiment').screenshot({path: 'test-results/learning-mobile-contribution.png'});
    await page.locator('[data-profile="sampling"]').screenshot({path: 'test-results/learning-mobile-sampling.png'});
    await page.locator('[data-profile="sampling"] .lab-bottom a').click();
    await page.waitForURL('**/lab/**');
    await labReady(page);
    const lab = await noHorizontalOverflow(page);
    await page.screenshot({path: 'test-results/learning-mobile-lab.png', fullPage: true});
    return {article, lab};
  });

  await scenario('without JavaScript the 390px article retains readable teaching content', async () => {
    const context = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}});
    const staticPage = await context.newPage();
    observeErrors(staticPage);
    try {
      await staticPage.goto(articleUrl);
      assert.equal(await staticPage.locator('article > h2').count(), 8);
      assert.equal(await staticPage.locator('.ao-lab .fallback svg').count(), 2);
      assert.equal(await staticPage.locator('.viewport > canvas').count(), 0);
      assert.equal(await staticPage.locator('.walk-experiment svg').count(), 1);
      assert.equal(await staticPage.locator('.contribution-experiment svg').count(), 2);
      assert.equal(await staticPage.locator('.contribution-readouts dd').count(), 3);
      assert.ok(await staticPage.locator('.katex').count() > 5);
      await staticPage.getByText('深入推导：从法线投影到解析切片积分', {exact: true}).click();
      assert.equal(await staticPage.locator('article > details .slice-experiment svg').isVisible(), true);
      const layout = await noHorizontalOverflow(staticPage);
      await staticPage.locator('.contribution-experiment').screenshot({path: 'test-results/learning-no-js-contribution.png'});
      await staticPage.locator('article > details .slice-experiment').screenshot({path: 'test-results/learning-no-js-slice.png'});
      return layout;
    } finally {
      await context.close();
    }
  });

  if (browserErrors.length) failures.push({name: 'browser console and runtime errors', errors: browserErrors});
  await writeFile('test-results/learning-results.json', JSON.stringify({passed: results, failures, browserErrors}, null, 2));
  console.log(`${results.length} learning scenarios passed; ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
