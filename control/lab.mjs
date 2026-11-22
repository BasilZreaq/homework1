import { defaults, simulate, piDynamics, randomPlant, scoreChallenge, challengeSpec, validation } from './engine.mjs';
import { arduinoSketch } from './arduino.mjs';
import { Plot } from './plot.mjs';

const $ = id => document.getElementById(id);
const fixed = (value, places = 3) => Number.isFinite(value) ? Number(value.toFixed(places)).toString() : '—';
const lab = new URLSearchParams(location.search).get('lab') ?? 'p1';
const page = ['p1', 'p2', 'p3', 'p4', 'system', 'validation'].includes(lab) ? lab : 'p1';
const config = {
  p1: {
    title: 'PID Playground',
    intro: 'Compare P, PI and PID on the same first- or second-order plant. Watch how each gain changes tracking and actuator effort.',
    base: { kp: 9, ki: 0 },
    presets: [
      ['P only', { kp: 9, ki: 0, upper: 12 }],
      ['PI tracking', { kp: 1, ki: 1 }],
      ['PID damping', { plant: 'second', zeta: .35, kp: 2.2, ki: 2.8, kd: .65 }]
    ],
    prediction: ['With the same first-order plant and Kp, which controller removes the step offset?',
      ['P only', 'PI'], 1]
  },
  p2: {
    title: 'Slow Sensor in the Loop',
    intro: 'Compare the true plant output with the first-order sensor signal that drives the controller.',
    base: { kp: 1.7, ki: 9, sensorTau: .04, duration: 24 },
    presets: [
      ['Fast sensor', { sensorTau: .04 }],
      ['Overshoot', { sensorTau: .23 }],
      ['Oscillation', { sensorTau: 1.2 }]
    ],
    prediction: ['Which sensor is more likely to produce persistent oscillations at these demonstration gains?',
      ['Fast sensor (τₛ = 0.04 s)', 'Slow sensor (τₛ = 1.2 s)'], 1]
  },
  p3: {
    title: 'Digital PID',
    intro: 'Sample the error on a fixed clock and hold the actuator command between updates. Compare sample rates or the effect of conditional integration.',
    base: { kp: 2.4, ki: 1.8, kd: .15, lower: 0, upper: 4, mode: 'digital' },
    presets: [
      ['Fast sampling', {}],
      ['Slow sampling', { samplePeriod: .9 }],
      ['Windup test', { kp: 3.4, ki: 5, kd: 0, upper: 1.22, samplePeriod: .08 }]
    ],
    prediction: ['When the sampling period increases, what happens to the length of each hold interval?',
      ['It gets longer', 'It gets shorter'], 0]
  },
  p4: {
    title: 'PID Tuning Challenge',
    intro: 'Tune a hidden first- or second-order plant against three specifications. The same plant stays in use until you start a new challenge.',
    base: { kp: .7, ki: .5, duration: 20 },
    prediction: ['Which target do you predict the current tuning will miss?',
      ['Overshoot', 'Settling time', 'Step error', 'All targets will pass']]
  },
  system: {
    title: 'My System',
    intro: 'Enter a first-order model from your project, record the evidence behind your specification, and simulate the Arduino controller.',
    base: { mode: 'digital', kp: 25, ki: 25, kd: 0, gain: .045, tau: .8, lower: 0, upper: 100 }
  },
  validation: {
    title: 'Numerical Validation',
    intro: 'Compare the RK4 simulations and the PI characteristic equation with the homework reference values.'
  }
};

const current = config[page];
const headings = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4', system: 'PROJECT APPLICATION', validation: 'REFERENCE CHECKS' };
const title = `<header class="page-title">
  <p class="eyebrow">${headings[page]} · Homework 2</p>
  <h1>${current.title}</h1><p>${current.intro}</p>
</header>`;
document.title = `${current.title} · ENCS4380`;
document.querySelector(`[data-lab="${page}"]`).setAttribute('aria-current', 'page');

const sliderSpecs = {
  kp: ['Proportional gain Kp', 0, 100, .01, 12],
  ki: ['Integral gain Ki', 0, 100, .01, 12],
  kd: ['Derivative gain Kd', 0, 30, .01, 3],
  gain: ['Plant gain K', .001, 1000, .001, 5],
  tau: ['Plant τ (s)', .01, 300, .01, 8],
  omega: ['Plant ωₙ (rad/s)', .05, 80, .05, 10],
  zeta: ['Plant damping ζ', 0, 5, .01, 2],
  reference: ['Setpoint step', -10000, 10000, .01, 5],
  sensorTau: ['Sensor τₛ (s)', 0, 10, .01, 3],
  samplePeriod: ['Sample period Tₛ (s)', .001, 10, .001, 2]
};

function slider(id) {
  const [label, min, max, step, sliderMax] = sliderSpecs[id];
  return `<div class="field" id="field-${id}">
    <label for="${id}">${label}</label>
    <div class="slider">
      <input type="range" aria-label="${label} slider" id="${id}-range" min="${id === 'reference' ? -5 : min}" max="${sliderMax}" step="${step}">
      <input type="number" id="${id}" min="${min}" max="${max}" step="any" required>
    </div>
  </div>`;
}

function field(id, label, type = 'text', min = '', max = '') {
  return `<div class="field"><label for="${id}">${label}</label>
    <input type="${type}" id="${id}" ${type === 'number' ? `min="${min}" max="${max}" step="any" required` : ''}>
  </div>`;
}

const advanced = `<details><summary>Actuator limits and duration</summary>
  <div class="pair">${field('lower', 'Lower limit', 'number', -10000, 10000)}
  ${field('upper', 'Upper limit', 'number', -10000, 10000)}</div>
  ${field('duration', 'Duration (s)', 'number', 0.1, 300)}
</details>`;

const modelFields = `${slider('gain')}${slider('tau')}${slider('omega')}${slider('zeta')}`;
const digitalFields = `${slider('samplePeriod')}
  <label class="check-label"><input type="checkbox" id="antiWindup"> Conditional anti-windup</label>`;
const plantSelect = `<div class="field"><label for="plant">Plant model</label>
  <select id="plant"><option value="first">First order · Module 1</option>
  <option value="second">Second order · Module 3</option></select></div>`;

function prediction() {
  const [question, answers] = current.prediction;
  return `<section class="panel">
    <h2>Predict, then check</h2>
    <div class="field"><label for="prediction">${question}</label>
      <select id="prediction"><option value="">Choose a prediction</option>
      ${answers.map((answer, index) => `<option value="${index}">${answer}</option>`).join('')}</select>
    </div>
    <button class="secondary" id="check-prediction">Check prediction</button>
    <p class="notice" id="prediction-result" role="status"></p>
  </section>`;
}

function diagram() {
  return `<section class="panel"><h2>Closed-loop block diagram</h2>
    <div class="diagram" aria-label="Setpoint minus measurement feeds the PID, actuator and plant. The measurement returns to the negative input.">
      <span>r(t)</span><span aria-hidden="true">→</span><span class="block">Σ (+r, −yₘ)</span>
      <span aria-hidden="true">→</span><span class="block">PID</span>
      <span aria-hidden="true">→</span><span class="block">Actuator limits</span>
      <span aria-hidden="true">→</span><span class="block" id="plant-block">Plant</span>
      <span aria-hidden="true">→</span><span>y(t)</span>
      <span class="feedback">yₘ(t) returns to Σ from ${page === 'p2' ? 'the first-order sensor' : 'the plant output'}.</span>
    </div>
    <p class="hint" id="model-description"></p>
  </section>`;
}

function chart(id, label, command = false) {
  return `<div class="chart ${command ? 'command' : ''}">
    <canvas id="${id}" role="img" aria-label="${label}"></canvas>
    <ul id="${id}-legend" class="legend" aria-label="Plot legend"></ul>
    <p class="chart-value" id="${id}-values"></p>
  </div>`;
}

const metrics = [
  ['Rise time (10–90%)', 'riseTime', ' s'],
  ['Overshoot', 'overshoot', '%'],
  ['Settling time (2%)', 'settlingTime', ' s'],
  ['Steady-state error', 'steadyError', '%']
];

function results() {
  return `<section class="panel" id="run-results"><div class="section-title">
    <h2>Step response</h2><a class="mobile-jump" href="#experiment-settings">Back to controls</a></div>
    ${chart('response', 'Output and setpoint versus time')}
    <dl class="metrics">${metrics.map(([label, key]) =>
      `<div class="metric"><dt>${label}</dt><dd id="${key}">—</dd></div>`).join('')}</dl>
    <p class="notice" id="run-status" role="status"></p>
    <p class="hint">Rise, overshoot and settling use the final output. Error uses the commanded step. Metrics require a settled tail.</p>
  </section>
  <section class="panel"><h2>Actuator command</h2>
    ${chart('command', 'Controller command and actuator limits versus time', true)}
    ${page === 'p3' ? '<p class="hint">Each horizontal segment is one zero-order hold. The control changes only at sample times.</p>' : ''}
  </section>`;
}

const codePanel = `<section class="panel">
  <div class="section-title"><h2>Arduino sketch</h2><button id="copy-code">Copy code</button></div>
  <p class="hint">Fill in the calibrated hardware functions before running the sketch on an Arduino.</p>
  <pre class="code" tabindex="0"><code id="arduino"></code></pre>
  <p class="notice" id="copy-result" role="status"></p>
</section>`;

const scorePanel = `<section class="panel"><div class="section-title">
  <h2>Challenge score</h2><strong id="score"></strong></div>
  <div class="table-scroll"><table>
    <thead><tr><th scope="col">Target</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead>
    <tbody id="score-rows"></tbody>
  </table></div>
  <p class="hint">Each passing target earns one point. The challenge uses a unit step and a 20 s run.</p>
</section>`;

const projectPanel = `<section class="panel"><h2>Project evidence</h2>
  <p class="notice" id="project-state"></p>
  ${field('plantName', 'Project and plant name')}
  <div class="pair">${field('outputUnit', 'Output units')}${field('inputUnit', 'Actuator units')}</div>
  ${field('source', 'Measurement record or datasheet citation')}
  <div class="field"><label for="specification">Performance specification</label><textarea id="specification"></textarea></div>
  <div class="field"><label for="justification">Why it matters for the project</label><textarea id="justification"></textarea></div>
  <label class="check-label"><input type="checkbox" id="motorMode"> Micromouse drive motor (PWM 0–100%)</label>
  <button class="secondary" id="save-project">Save project in this browser</button>
  <p class="notice" id="save-result" role="status"></p>
</section>`;

const digits = value => value === 0 ? '0' : Math.abs(value) < .001 ? value.toExponential(3) : fixed(value, 6);

function renderValidation() {
  const checks = validation();
  $('app').innerHTML = `${title}
    <section class="panel">
      <div class="section-title"><h2>Reference results</h2>
      <strong id="validation-count">${checks.filter(check => check.pass).length}/${checks.length} passed</strong></div>
      <p>Tests use G(s) = 1/(s + 1), a unit step and actuator limits ±100. The RK4 paths use integration steps of 0.01 s or less.</p>
      <div class="table-scroll"><table>
        <thead><tr><th scope="col">Check</th><th scope="col">Expected</th><th scope="col">Calculated</th>
        <th scope="col">Tolerance</th><th scope="col">Result</th></tr></thead>
        <tbody>${checks.map(check => `<tr><th scope="row">${check.label}</th><td>${digits(check.expected)}</td>
        <td>${digits(check.calculated)}</td><td>${digits(check.tolerance)}</td>
        <td class="${check.pass ? 'pass' : 'fail'}">${check.pass ? 'PASS' : 'FAIL'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">For PI, the characteristic equation is τs² + (1 + KKp)s + KKi = 0. Its coefficients give ωₙ and ζ. The simulated step is checked separately against 1 − e⁻ᵗ for the reference gains.</p>
    </section>`;
}

function build() {
  const presets = current.presets?.map(([label], index) => `<button class="secondary" data-preset="${index}">${label}</button>`).join('');
  const modelControls = page === 'p4' ? '' : page === 'system'
    ? `${slider('gain')}${slider('tau')}${slider('reference')}`
    : `${plantSelect}${modelFields}${slider('reference')}`;
  const manageRound = '<button class="secondary" id="reset-tuning">Reset gains</button><button id="new-challenge">New challenge</button>';
  const compare = `<label class="check-label"><input type="checkbox" id="fast-comparison" checked> Overlay fast sample (0.02 s)</label>
    <label class="check-label"><input type="checkbox" id="windup-comparison"> Compare opposite anti-windup setting</label>`;
  $('app').innerHTML = `${title}<div class="layout">
    <aside class="stack" id="experiment-settings" aria-label="Experiment controls">
      ${page === 'system' ? projectPanel : ''}
      <section class="panel">
        <div class="section-title"><h2>${page === 'p4' ? 'Tune the controller' : 'Experiment controls'}</h2>
          <a class="mobile-jump" href="#run-results">Jump to plot</a></div>
        ${presets ? `<div class="actions">${presets}</div>` : ''}
        ${page !== 'p4' && page !== 'system' ? '<button class="secondary" id="load-project" hidden>Load saved project plant</button>' : ''}
        ${modelControls}${slider('kp')}${slider('ki')}${slider('kd')}
        ${page === 'p2' ? slider('sensorTau') : ''}
        ${page === 'p3' || page === 'system' ? digitalFields : ''}
        ${page === 'p3' ? compare : ''}
        ${page === 'p4' ? `<div class="actions">${manageRound}</div>` : advanced}
      </section>
      ${current.prediction ? prediction() : ''}
    </aside>
    <div class="stack">
      ${['p1', 'p2', 'system'].includes(page) ? diagram() : ''}
      ${page === 'p3' ? `<section class="panel"><h2>Sampled controller</h2>
        <p>u[k] = Kp·e[k] + Ki·Tₛ·Σe[j] + Kd·(e[k] − e[k−1])/Tₛ</p>
        <p class="hint">The sum starts at j = 0 and e[−1] = 0. Conditional integration skips a term if it would drive a saturated command further into the active limit.</p>
      </section>` : ''}
      ${page === 'p4' ? scorePanel : ''}
      ${results()}
      ${page === 'p3' || page === 'system' ? codePanel : ''}
    </div>
  </div>`;
  start();
}

const storageKey = 'encs4380-project-v2';
// Populate this with the group's reviewed plant record to include it in a release.
const publishedProject = null;
const evidenceKeys = ['plantName', 'outputUnit', 'inputUnit', 'source', 'specification', 'justification'];
const projectNumberKeys = ['gain', 'tau', 'reference', 'kp', 'ki', 'kd', 'samplePeriod', 'lower', 'upper', 'duration'];

function savedProject() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey));
    return data && evidenceKeys.every(key => typeof data[key] === 'string')
      && projectNumberKeys.every(key => Number.isFinite(data[key]))
      && typeof data.motorMode === 'boolean' && typeof data.antiWindup === 'boolean' ? data : null;
  } catch {
    return null;
  }
}

const startValues = () => ({ ...defaults, ...current.base, ...(page === 'p1' ? { upper: 12 } : {}) });
const colors = { output: '#177760', reference: '#556777', sensor: '#a65a1c', limit: '#8b5c54', alternate: '#7255ab' };
const trace = (label, points, key, color, options) => ({ label, points, key, color, ...options });
const constant = (label, end, value, color) => trace(label,
  [{ time: 0, value }, { time: end, value }], 'value', color, { dash: true, width: 1.5 });

function start() {
  const plots = Object.fromEntries(['response', 'command'].map(id => [
    id, new Plot($(id), { legend: $(id + '-legend'), readout: $(id + '-values') })
  ]));
  let hiddenPlant = page === 'p4' ? randomPlant() : {};
  const draft = savedProject();
  let project = draft ?? publishedProject;
  let run;
  let frame;

  function fill(values) {
    for (const [key, value] of Object.entries(values)) {
      const input = $(key);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      if ($(key + '-range')) $(key + '-range').value = value;
    }
  }

  function motorLimits() {
    const motor = $('motorMode')?.checked;
    if (!$('motorMode')) return;
    $('inputUnit').readOnly = $('lower').readOnly = $('upper').readOnly = motor;
    if (motor) fill({ lower: 0, upper: 100, inputUnit: '% PWM' });
  }

  function readValues() {
    const values = { ...startValues(), ...hiddenPlant };
    for (const key of Object.keys(defaults)) {
      const input = $(key);
      if (!input || input.closest('[hidden]')) continue;
      if (input.type === 'checkbox') values[key] = input.checked;
      else if (input.type === 'number') {
        if (!input.validity.valid) throw new RangeError(`Check ${input.labels[0].textContent}. Use a value from ${input.min} to ${input.max}.`);
        values[key] = input.valueAsNumber;
      } else values[key] = input.value;
    }
    return values;
  }

  function showMetrics(values, s) {
    for (const [, key, suffix] of metrics) {
      const value = key === 'steadyError' ? 100 * values[key] / Math.abs(s?.reference) : values[key];
      $(key).textContent = Number.isFinite(value) ? fixed(value) + suffix : '—';
    }
  }

  function challengeScore() {
    const m = run?.metrics ?? {};
    const score = scoreChallenge(m);
    const lines = [
      ['Overshoot ≤ ' + challengeSpec.overshoot + '%', m.overshoot, '%', score.overshoot],
      ['Settling time ≤ ' + challengeSpec.settlingTime + ' s', m.settlingTime, ' s', score.settlingTime],
      ['Absolute step error ≤ ' + challengeSpec.errorPercent + '%', Math.abs(m.steadyError) * 100, '%', score.errorPercent]
    ];
    $('score').textContent = `${Object.values(score).filter(Boolean).length}/3 targets`;
    $('score-rows').innerHTML = lines.map(([label, value, unit, pass]) => `<tr>
      <th scope="row">${label}</th><td>${Number.isFinite(value) ? fixed(value) + unit : '—'}</td>
      <td class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</td></tr>`).join('');
  }

  function update() {
    frame = undefined;
    if ($('plant')) {
      const second = $('plant').value === 'second';
      $('field-tau').hidden = second;
      $('field-omega').hidden = $('field-zeta').hidden = !second;
    }
    if (page === 'system') motorLimits();
    const status = $('run-status');
    let error;
    try {
      run = simulate(readValues());
    } catch (problem) {
      error = problem.message;
      run = null;
    }
    const s = run?.settings;
    const state = run?.metrics.state;
    status.dataset.kind = state === 'settled' ? 'ok' : 'warn';
    status.textContent = error ?? (state === 'settled' ? 'Response settled within the simulated window.'
      : state === 'diverged' ? 'Simulation stopped when a state became too large or non-finite.'
        : 'The response did not settle in this window. Look for slow convergence or continuing oscillation.');
    showMetrics(run?.metrics ?? {}, s);
    if (page === 'p4') challengeScore();
    if ($('arduino')) {
      $('arduino').textContent = run ? arduinoSketch(s, { pwm: $('motorMode')?.checked }) : '';
      $('copy-code').disabled = !run;
      $('copy-result').textContent = '';
    }
    if ($('model-description')) {
      $('plant-block').textContent = s?.plant === 'second' ? 'Second-order plant' : 'First-order plant';
      let description = s?.plant === 'second' ? `G(s) = Kωₙ²/(s² + 2ζωₙs + ωₙ²), K = ${fixed(s.gain)}, ωₙ = ${fixed(s.omega)} rad/s, ζ = ${fixed(s.zeta)}.`
        : s ? `G(s) = K/(τs + 1), K = ${fixed(s.gain)}, τ = ${fixed(s.tau)} s.` : '';
      if (page === 'p2') description += ' Sensor model: τₛ·dyₘ/dt + yₘ = y. At τₛ = 0 the feedback is ideal.';
      if (page === 'p1') description += ' Continuous derivative acts on the measurement to avoid an ideal step impulse.';
      if (page === 'system' && $('motorMode').checked) {
        const pi = s && piDynamics(s);
        description += pi ? ` Continuous, unsaturated PI reference ζ = ${fixed(pi.zeta)} (target 0.6–0.8).`
          : ' Use the measured motor model to target a damping ratio of 0.6–0.8 where applicable.';
      }
      $('model-description').textContent = description;
    }
    if (!run?.points.length) {
      plots.response.update([]);
      plots.command.update([]);
      return;
    }

    const end = run.points.at(-1).time;
    const responses = [
      constant('Setpoint', s.duration, s.reference, colors.reference),
      trace('Plant output', run.points, 'output', colors.output, { width: 2.5 })
    ];
    if (page === 'p2') responses.push(trace('Sensor output', run.points, 'measured', colors.sensor, { dash: true }));
    if (page === 'p3' && $('fast-comparison').checked && s.samplePeriod !== .02) {
      plotAlternative(responses, { ...s, samplePeriod: .02 }, 'Output · Tₛ 0.02 s', colors.alternate);
    }
    if (page === 'p3' && $('windup-comparison').checked) {
      plotAlternative(responses, { ...s, antiWindup: !s.antiWindup }, `Output · anti-windup ${s.antiWindup ? 'off' : 'on'}`, colors.sensor);
    }
    const command = [
      constant('Upper limit', end, s.upper, colors.limit),
      constant('Lower limit', end, s.lower, colors.limit),
      trace('Control u', s.mode === 'digital' ? run.commands : run.points, 'control', colors.output,
        { width: 2.5, step: s.mode === 'digital' })
    ];
    plots.response.update(responses, `Output (${$('outputUnit')?.value.trim() || 'model units'})`);
    plots.command.update(command, `Command (${$('inputUnit')?.value.trim() || 'model units'})`);
  }

  function plotAlternative(traces, settings, label, color) {
    try {
      const alternative = simulate(settings);
      traces.push(trace(label, alternative.points, 'output', color, { dash: true }));
    } catch {
      $('run-status').textContent += ' The comparison exceeds the integration budget.';
    }
  }

  function queue() {
    if (frame === undefined) frame = requestAnimationFrame(update);
  }

  function predictionCheck() {
    const choice = $('prediction').value;
    const feedback = $('prediction-result');
    if (choice === '') {
      feedback.textContent = 'Choose a prediction first.';
      return;
    }
    if (page === 'p4') {
      const score = scoreChallenge(run?.metrics ?? {});
      const passes = Object.values(score);
      const right = +choice === 3 ? passes.every(Boolean) : !passes[+choice];
      feedback.textContent = `${right ? 'Your prediction matches this run.' : 'This run differs from your prediction.'} See the score above.`;
      return;
    }
    const verdict = +choice === current.prediction[2] ? 'Correct.' : 'Try the comparison.';
    if (page === 'p1') {
      const p = simulate({ kp: 1, ki: 0 });
      const pi = simulate({ kp: 1, ki: 1 });
      feedback.textContent = `${verdict} At Kp = 1 the P loop leaves ${fixed(p.metrics.steadyError * 100)}% error. Adding Ki = 1 reduces it to ${fixed(pi.metrics.steadyError * 100)}% in the simulation.`;
    } else if (page === 'p2') {
      const fast = simulate({ ...startValues(), sensorTau: .04 });
      const slow = simulate({ ...startValues(), sensorTau: 1.2 });
      feedback.textContent = `${verdict} At τₛ = 0.04 s the demo response ${fast.metrics.state === 'settled' ? 'settles' : 'is still changing'}.
        At τₛ = 1.2 s it ${slow.metrics.state === 'settled' ? 'settles' : 'keeps oscillating in the plotted window'}. Apply the Oscillation preset to see both traces.`;
    } else {
      const fast = simulate({ ...startValues(), samplePeriod: .05 });
      const slow = simulate({ ...startValues(), samplePeriod: .9 });
      feedback.textContent = `${verdict} The first holds last ${fixed(fast.commands[1].time)} s and ${fixed(slow.commands[1].time)} s in the two presets. Compare the stair steps below.`;
    }
  }

  function markProject() {
    let message = 'The initial settings are illustrative. Enter your plant, measured or cited K and τ, and your own specification and rationale.';
    if (project) {
      message = project === publishedProject ? 'Using the project data bundled with this version of the toolkit.'
        : 'Project settings are saved in this browser. Confirm the evidence and hardware interface before submission.';
    }
    $('project-state').textContent = message;
  }

  function storeProject() {
    const entries = Object.fromEntries(evidenceKeys.map(key => [key, $(key).value.trim()]));
    const message = $('save-result');
    try {
      if (['plantName', 'source', 'specification', 'justification'].some(key => !entries[key])) {
        throw new Error('Enter the plant name, parameter source, performance specification and justification.');
      }
      const settings = simulate(readValues()).settings;
      const numerical = Object.fromEntries(projectNumberKeys.map(key => [key, settings[key]]));
      const data = { ...entries, ...numerical, antiWindup: settings.antiWindup, motorMode: $('motorMode').checked };
      localStorage.setItem(storageKey, JSON.stringify(data));
      project = data;
      markProject();
      message.dataset.kind = 'ok';
      message.textContent = 'Saved. Load this plant from P1, P2 or P3 in this browser.';
    } catch (problem) {
      message.dataset.kind = 'warn';
      message.textContent = problem.message;
    }
  }

  fill(startValues());
  if (page === 'system') {
    if (project) fill(project);
    markProject();
    $('save-project').addEventListener('click', storeProject);
  }
  if ($('load-project') && project) {
    $('load-project').hidden = false;
    $('load-project').addEventListener('click', () => {
      fill({ ...project, plant: 'first' });
      update();
    });
  }
  $('app').addEventListener('input', event => {
    const input = event.target;
    if (input.id === 'prediction') {
      $('prediction-result').textContent = '';
      return;
    }
    if (input.type === 'range') $(input.id.replace(/-range$/, '')).value = input.value;
    else if ($(input.id + '-range')) $(input.id + '-range').value = input.value;
    if (page === 'system' && (evidenceKeys.includes(input.id) || input.closest('aside'))) {
      $('save-result').textContent = '';
      $('project-state').textContent = 'Unsaved project settings. Save to use these values in P1–P3.';
    }
    if ($('prediction-result') && page === 'p4') $('prediction-result').textContent = '';
    queue();
  });
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => {
      const [label, values] = current.presets[Number(button.dataset.preset)];
      fill({ ...startValues(), ...values });
      if (page === 'p3') {
        $('fast-comparison').checked = label !== 'Windup test';
        $('windup-comparison').checked = label === 'Windup test';
      }
      update();
    });
  }
  if (page === 'p4') {
    const reset = () => {
      fill(startValues());
      $('prediction').value = '';
      $('prediction-result').textContent = '';
      update();
    };
    $('reset-tuning').addEventListener('click', reset);
    $('new-challenge').addEventListener('click', () => {
      hiddenPlant = randomPlant();
      reset();
    });
  }
  $('check-prediction')?.addEventListener('click', predictionCheck);
  $('copy-code')?.addEventListener('click', async () => {
    const message = $('copy-result');
    try {
      await navigator.clipboard.writeText($('arduino').textContent);
      message.dataset.kind = 'ok';
      message.textContent = 'Arduino sketch copied.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('arduino'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      message.dataset.kind = 'warn';
      message.textContent = 'Sketch selected. Press Ctrl+C or use your device’s Copy command.';
    }
  });
  update();
}

if (page === 'validation') renderValidation();
else build();
