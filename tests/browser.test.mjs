import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = '/homework1/';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', png: 'image/png' };

async function staticResponse(request, response) {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (!pathname.startsWith(prefix)) throw new Error('Invalid site path');
    const localPath = decodeURIComponent(pathname.slice(prefix.length));
    const file = resolve(root, localPath.endsWith('/') || !localPath ? localPath + 'index.html' : localPath);
    const extension = file.toLowerCase().split('.').at(-1);
    if (relative(root, file).startsWith('..') || !types[extension]) throw new Error('Invalid file path');
    response.setHeader('Content-Type', types[extension] + (extension === 'png' ? '' : '; charset=utf-8'));
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end('Not found');
  }
}

test('desktop and mobile site, legacy regressions and all interactive labs', async t => {
  let base = process.env.TOOLKIT_BASE_URL;
  if (!base) {
    const server = createServer(staticResponse);
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    t.after(() => new Promise(resolveClose => server.close(resolveClose)));
    base = `http://127.0.0.1:${server.address().port}${prefix}`;
  }
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const open = async path => {
    const result = await page.goto(base + path);
    assert.equal(result.status(), 200);
  };
  const text = id => page.locator('#' + id).innerText();
  const plotImage = id => page.locator('#' + id).evaluate(canvas => canvas.toDataURL());
  const waitForText = (id, value) => page.waitForFunction(([key, expected]) =>
    document.getElementById(key)?.textContent.includes(expected), [id, value]);
  const screenshot = async name => {
    if (process.env.QA_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.QA_SCREENSHOTS, name + '.png'), fullPage: true });
    }
  };

  await t.test('landing links to every module and home renders at a project subpath', async () => {
    await open('');
    assert.equal(await page.locator('.module-card').count(), 10);
    const links = await page.locator('.module-card').evaluateAll(elements => elements.map(element => element.href));
    for (const link of links) assert.equal((await context.request.get(link)).status(), 200, link);
    assert.match(await text('hero-legend'), /PI step response/);
    await screenshot('landing-desktop');
  });

  await t.test('all four Homework 1 modules still plot and react to controls', async () => {
    await open('module1.html');
    await page.locator('#responsePlot .main-svg').first().waitFor();
    await page.selectOption('#inputType', 'ramp');
    await waitForText('responseTitle', 'Ramp response');
    assert.equal(await page.locator('#checks .pass').count(), 2);

    await open('ahmad_index.html');
    assert.ok(await page.evaluate(() => !!window.Chart), 'Module 2 Chart.js must load');
    const canvas = page.locator('canvas').first();
    const before = await canvas.evaluate(element => element.toDataURL());
    await page.locator('input[type="range"]').first().press('End');
    await page.waitForFunction(image => document.querySelector('canvas').toDataURL() !== image, before);

    await open('Module3-Majd.html');
    for (const id of ['stepPlot', 'polePlot', 'phasePlot']) {
      await page.locator('#' + id + ' .main-svg').first().waitFor();
    }
    assert.equal(await page.locator('#validation .pass').count(), 3);

    await open('Module4_GuessTheSensor_Zaid.html');
    await page.locator('#responsePlot .main-svg').first().waitFor();
    await page.locator('#check').click();
    await waitForText('status', 'Revealed');
    await page.getByRole('button', { name: 'New sensor' }).click();
    await waitForText('status', 'Guessing');
    assert.equal((await page.getByRole('link', { name: 'Toolkit home' }).getAttribute('href')), './');
  });

  await t.test('P1 presets, gain changes, graph redraw, prediction and invalid inputs', async () => {
    await open('control/?lab=p1');
    await waitForText('steadyError', '10%');
    const before = await plotImage('response');
    await page.getByRole('button', { name: 'PI tracking' }).click();
    await waitForText('steadyError', '0%');
    assert.notEqual(await plotImage('response'), before);
    await page.locator('#kp-range').press('ArrowRight');
    await page.waitForFunction(() => document.getElementById('kp').value === '1.01');
    await page.locator('#response').press('ArrowRight');
    await waitForText('response-values', 'Plant output');
    await page.locator('#kp').focus();
    await page.getByRole('button', { name: 'PID damping' }).click();
    assert.equal(await page.locator('#plant').inputValue(), 'second');
    assert.ok(await page.locator('#omega').isVisible());
    assert.ok(await page.locator('#tau').isHidden());
    await page.selectOption('#prediction', '1');
    await page.getByRole('button', { name: 'Check prediction' }).click();
    await waitForText('prediction-result', 'Correct.');
    await screenshot('playground-desktop');
    await page.locator('#omega').fill('0');
    await waitForText('run-status', 'Check Plant');
    assert.equal(await text('riseTime'), '—');
  });

  await t.test('P2 traces show lag and sustained oscillation', async () => {
    await open('control/?lab=p2');
    await waitForText('response-legend', 'Sensor output');
    const fast = Number.parseFloat(await text('overshoot'));
    await page.getByRole('button', { name: 'Overshoot' }).click();
    assert.ok(Number.parseFloat(await text('overshoot')) > fast + 30);
    await page.getByRole('button', { name: 'Oscillation' }).click();
    await waitForText('run-status', 'did not settle');
    assert.equal(await text('overshoot'), '—');
    await page.selectOption('#prediction', '1');
    await page.getByRole('button', { name: 'Check prediction' }).click();
    await waitForText('prediction-result', 'keeps oscillating');
  });

  await t.test('P3 sampling, anti-windup comparison and clipboard', async () => {
    await open('control/?lab=p3');
    await waitForText('arduino', 'SAMPLE_US = 50000UL');
    const fast = await plotImage('command');
    await page.getByRole('button', { name: 'Slow sampling' }).click();
    await waitForText('arduino', 'SAMPLE_US = 900000UL');
    assert.notEqual(await plotImage('command'), fast);
    assert.match(await text('response-legend'), /Tₛ 0.02 s/);
    await page.getByRole('button', { name: 'Windup test' }).click();
    await waitForText('response-legend', 'anti-windup off');
    await page.uncheck('#antiWindup');
    await waitForText('arduino', 'ANTI_WINDUP = false');
    assert.match(await text('response-legend'), /anti-windup on/);
    await page.getByRole('button', { name: 'Copy code' }).click();
    await waitForText('copy-result', 'copied');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboard.replace(/\r\n/g, '\n'), await text('arduino'));
    await page.selectOption('#prediction', '0');
    await page.getByRole('button', { name: 'Check prediction' }).click();
    await waitForText('prediction-result', '0.05 s and 0.9 s');
  });

  await t.test('P4 score updates, resets with same plant, and replaces it on request', async () => {
    await open('control/?lab=p4');
    const original = await plotImage('response');
    assert.equal(await page.locator('#score-rows tr').count(), 3);
    assert.equal(await page.locator('#gain, #tau, #omega').count(), 0);
    await page.locator('#kp').fill('2');
    await page.locator('#ki').fill('2');
    await page.locator('#kd').fill('0.5');
    await waitForText('score', '3/3');
    await page.selectOption('#prediction', '3');
    await page.getByRole('button', { name: 'Check prediction' }).click();
    await waitForText('prediction-result', 'matches');
    await page.getByRole('button', { name: 'Reset gains' }).click();
    assert.equal(await plotImage('response'), original);
    await page.getByRole('button', { name: 'New challenge' }).click();
    assert.notEqual(await plotImage('response'), original);
  });

  await t.test('PI reference comparison, PWM mode and project settings persist', async () => {
    await open('control/?lab=system');
    await waitForText('project-state', 'Illustrative');
    assert.equal(await page.locator('#pi-reference tbody .pass').count(), 7);
    await screenshot('my-system-desktop');
    await page.getByRole('link', { name: 'Open reference in PID Playground' }).click();
    assert.equal(await page.locator('#kp').inputValue(), '1.8');
    assert.equal(await page.locator('#ki').inputValue(), '4');
    await waitForText('overshoot', '9.531%');
    await page.getByText('Actuator limits and duration').click();
    await page.locator('#lower').fill('0');
    await page.locator('#upper').fill('1.05');
    await waitForText('overshoot', '0.545%');
    await open('control/?lab=system');
    await page.getByRole('button', { name: 'Save project in this browser' }).click();
    await waitForText('save-result', 'Enter the plant name');
    for (const [id, value] of Object.entries({
      plantName: 'UI test fixture', outputUnit: 'rpm', source: 'Browser test source',
      specification: 'Browser test spec', justification: 'Browser test rationale', gain: '.052', tau: '0.7'
    })) await page.locator('#' + id).fill(value);
    await page.locator('#inputUnit').fill('V');
    await page.check('#motorMode');
    await waitForText('arduino', '0–100% duty command');
    assert.equal(await page.locator('#inputUnit').inputValue(), '% PWM');
    await page.uncheck('#motorMode');
    await waitForText('arduino', 'from model units');
    assert.equal(await page.locator('#inputUnit').inputValue(), 'V');
    await page.check('#motorMode');
    await waitForText('arduino', '0–100% duty command');
    await page.getByRole('button', { name: 'Save project in this browser' }).click();
    await waitForText('save-result', 'Saved.');
    await page.reload();
    assert.equal(await page.locator('#gain').inputValue(), '0.052');
    for (const lab of ['p1', 'p2', 'p3']) {
      await open('control/?lab=' + lab);
      await page.getByRole('button', { name: 'Load saved project plant' }).click();
      assert.equal(await page.locator('#plant').inputValue(), 'first');
      assert.equal(await page.locator('#gain').inputValue(), '0.052');
      assert.equal(await page.locator('#tau').inputValue(), '0.7');
    }
  });

  await t.test('validation and responsive layout', async () => {
    await open('control/?lab=validation');
    await waitForText('validation-count', '8/8 passed');
    assert.equal(await page.locator('#assignment-validation tbody .pass').count(), 8);
    assert.equal(await page.locator('#pi-reference tbody .pass').count(), 7);
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ['', 'control/?lab=p1', 'control/?lab=p2', 'control/?lab=p3', 'control/?lab=p4',
      'control/?lab=system', 'control/?lab=validation', 'module1.html', 'ahmad_index.html',
      'Module3-Majd.html', 'Module4_GuessTheSensor_Zaid.html']) {
      await open(path);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path + ' overflows');
    }
    await open('control/?lab=p3');
    await page.getByRole('link', { name: 'Jump to plot' }).click();
    assert.ok(page.url().endsWith('#run-results'));
    await screenshot('digital-mobile');
    await open('control/?lab=validation');
    assert.ok(await page.locator('.table-scroll').evaluateAll(tables =>
      tables.every(table => table.scrollWidth <= table.clientWidth)));
    await screenshot('validation-mobile');
  });
  assert.deepEqual(errors, [], 'Any uncaught browser errors');
});
