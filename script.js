// ENCS4380, Module 1: First-order time response
// Equations: tau * dy/dt + y = K * x

const byId = (id) => document.getElementById(id);
const format = (value, digits = 2) => value.toFixed(digits);

const DEFAULTS = { gain: 1, tau: 2, amplitude: 10, rampSlope: 1, inputType: 'step' };
const PLOT_OPTIONS = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d', 'select2d']
};

// 1. Sensor equations
function stepResponse(time, gain, tau, amplitude) {
  return gain * amplitude * (1 - Math.exp(-time / tau));
}

function rampResponse(time, gain, tau, slope) {
  return gain * slope * (time - tau * (1 - Math.exp(-time / tau)));
}

// 2. Read the current controls
function getSettings() {
  return {
    gain: Number(byId('gain').value),
    tau: Number(byId('tau').value),
    amplitude: Number(byId('amplitude').value),
    rampSlope: Number(byId('rampSlope').value),
    isStep: byId('inputType').value === 'step'
  };
}

// 3. Create the data used in the graphs
function createData(settings) {
  const { gain, tau, amplitude, rampSlope, isStep } = settings;
  const times = Array.from({ length: 241 }, (_, i) => i * 6 * tau / 240);

  const ideal = times.map((time) => isStep ? gain * amplitude : gain * rampSlope * time);
  const output = times.map((time) => isStep
    ? stepResponse(time, gain, tau, amplitude)
    : rampResponse(time, gain, tau, rampSlope));

  return { times, ideal, output };
}

// 4. Shared graph appearance
function drawPlot(elementId, traces, extraLayout = {}) {
  const layout = {
    paper_bgcolor: '#151e32',
    plot_bgcolor: '#151e32',
    font: { color: '#d6e2f6', size: 12 },
    margin: { l: 65, r: 20, t: 20, b: 55 },
    legend: { orientation: 'h', y: 1.18 },
    xaxis: { title: 'Time (s)', gridcolor: '#33415a' },
    yaxis: { title: 'Sensor output', gridcolor: '#33415a' },
    ...extraLayout
  };

  Plotly.react(elementId, traces, layout, PLOT_OPTIONS);
}

// 5. Update slider labels and show the relevant input controls
function updateControls(settings) {
  byId('gainValue').textContent = format(settings.gain);
  byId('tauValue').textContent = format(settings.tau, 1) + ' s';
  byId('amplitudeValue').textContent = format(settings.amplitude, 1);
  byId('rampSlopeValue').textContent = format(settings.rampSlope, 1) + ' /s';

  byId('stepOptions').classList.toggle('hidden', !settings.isStep);
  byId('rampOptions').classList.toggle('hidden', settings.isStep);
}

// 6. Draw the first-order step or ramp response
function drawResponse(settings, data) {
  const { gain, tau, amplitude, isStep } = settings;
  const traces = [
    { x: data.times, y: data.ideal, name: 'Ideal output', mode: 'lines',
      line: { color: '#8999b7', width: 2, dash: 'dash' } },
    { x: data.times, y: data.output, name: 'Sensor output', mode: 'lines',
      line: { color: '#65e1c8', width: 4 } }
  ];

  const shapes = [];
  if (isStep) {
    const markerTimes = [tau, 3 * tau];
    const markerValues = markerTimes.map((time) => stepResponse(time, gain, tau, amplitude));

    traces.push({
      x: markerTimes, y: markerValues, name: '63.2% and 95%',
      mode: 'markers+text', text: ['63.2% at τ', '95.0% at 3τ'],
      textposition: ['top right', 'bottom right'],
      marker: { size: 11, color: '#ffc977' }
    });

    for (const time of markerTimes) {
      shapes.push({ type: 'line', x0: time, x1: time, y0: 0, y1: gain * amplitude,
        line: { color: '#ffc977', dash: 'dot', width: 1 } });
    }
  }

  byId('responseTitle').textContent = isStep ? 'Step response' : 'Ramp response';
  drawPlot('responsePlot', traces, { shapes });
}

// 7. Update calculated values below the sliders
function updateMetrics(settings) {
  const { gain, tau, amplitude, rampSlope, isStep } = settings;
  const responseAt = (time) => isStep
    ? stepResponse(time, gain, tau, amplitude)
    : rampResponse(time, gain, tau, rampSlope);

  byId('mTau').textContent = format(tau, 1) + ' s';
  byId('mGain').textContent = format(gain);
  byId('metric3Name').textContent = isStep ? 'Final output KA' : 'Ramp steady-state lag';
  byId('mFinal').textContent = isStep ? format(gain * amplitude) : format(tau) + ' s';
  byId('metric4Name').textContent = 'Output at τ';
  byId('mTauOut').textContent = format(responseAt(tau));
  byId('metric5Name').textContent = 'Output at 3τ';
  byId('m3TauOut').textContent = format(responseAt(3 * tau));
  byId('metric6Name').textContent = isStep ? 'Steady-state error' : 'Steady-state tracking error';
  byId('mError').textContent = isStep ? '0.000' : format(gain * rampSlope * tau, 3);

  byId('responseExplanation').textContent = isStep
    ? 'At τ, the sensor reaches 63.2% of its final value. At 3τ, it reaches 95.0%. A larger τ means a slower response.'
    : `The output lags the ramp by ${format(tau)} s. The steady-state tracking error Kaτ is ${format(gain * rampSlope * tau, 3)}.`;
}

// 8. Draw the normalized step error on a logarithmic axis
function drawErrorPlot(settings, times) {
  const errorFraction = times.map((time) => Math.exp(-time / settings.tau));

  drawPlot('errorPlot', [{
    x: times, y: errorFraction, name: 'Step error fraction', mode: 'lines',
    line: { color: '#78b9ff', width: 3 }
  }], {
    yaxis: { title: 'Error fraction (log scale)', type: 'log', range: [-3, 0.1], gridcolor: '#33415a' },
    showlegend: false
  });

  byId('slopeText').textContent =
    `Slope of ln(error fraction): −1/τ = ${format(-1 / settings.tau, 3)} s⁻¹.` +
    (settings.isStep ? '' : ' This is the step-response error shown for reference.');
}

// 9. Check the two required numerical results
function showValidationChecks() {
  const tests = [
    { label: 'At t = τ', expected: 0.632, actual: 1 - Math.exp(-1) },
    { label: 'At t = 3τ', expected: 0.950, actual: 1 - Math.exp(-3) }
  ];

  const container = byId('checks');
  container.replaceChildren();

  for (const test of tests) {
    const passed = Math.abs(test.actual - test.expected) <= 0.001;
    const row = document.createElement('div');
    row.className = 'check';
    row.innerHTML = `<span><strong>${test.label}</strong><br>Expected: ${format(test.expected, 3)} KA · Calculated: ${format(test.actual, 4)} KA</span><strong class="${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'}</strong>`;
    container.appendChild(row);
  }
}

// 10. Predict, then check interaction
function checkPrediction() {
  const answer = byId('prediction').value;
  const feedback = byId('feedback');
  feedback.classList.remove('hidden');

  if (!answer) {
    feedback.textContent = 'Choose a prediction first.';
  } else if (answer === 'slower') {
    feedback.textContent = 'Correct! Increasing τ makes the response slower. Try the slider.';
  } else {
    feedback.textContent = 'Not quite. Increasing τ makes the sensor slower to reach its target.';
  }
}

// 11. Main update, called whenever a control changes
function update() {
  const settings = getSettings();
  const data = createData(settings);

  updateControls(settings);
  updateMetrics(settings);
  drawResponse(settings, data);
  drawErrorPlot(settings, data.times);
}

// 12. Restore the initial control values
function resetControls() {
  for (const [id, value] of Object.entries(DEFAULTS)) {
    byId(id).value = value;
  }

  byId('prediction').value = '';
  byId('feedback').classList.add('hidden');
  update();
}

// 13. Start the page and connect the buttons/sliders
function init() {
  if (!window.Plotly) {
    byId('responsePlot').textContent = 'Plotly could not load. Connect to the internet and refresh.';
    byId('errorPlot').textContent = 'Plotting library unavailable.';
    return;
  }

  for (const id of ['gain', 'tau', 'amplitude', 'rampSlope', 'inputType']) {
    byId(id).addEventListener('input', update);
  }

  byId('reset').addEventListener('click', resetControls);
  byId('checkPrediction').addEventListener('click', checkPrediction);
  showValidationChecks();
  update();
}

init();
