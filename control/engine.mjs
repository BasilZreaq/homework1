const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

export const defaults = Object.freeze({
  plant: 'first', gain: 1, tau: 1, omega: 2, zeta: 0.5,
  kp: 2, ki: 1, kd: 0, reference: 1, sensorTau: 0,
  lower: -5, upper: 5, duration: 16, mode: 'continuous',
  samplePeriod: 0.05, antiWindup: true
});

export function settingsFor(values = {}) {
  const settings = { ...defaults, ...values };
  for (const [key, value] of Object.entries(settings)) {
    if (typeof defaults[key] === 'number' && !Number.isFinite(value)) {
      throw new RangeError(`Enter a finite value for ${key}.`);
    }
  }
  const { gain, tau, omega, zeta, kp, ki, kd, sensorTau, lower, upper,
    duration, samplePeriod, plant, mode, reference } = settings;
  if (!['first', 'second'].includes(plant) || !['continuous', 'digital'].includes(mode)) {
    throw new RangeError('Choose a supported plant and controller.');
  }
  if (gain <= 0 || tau <= 0 || omega <= 0 || zeta < 0 || sensorTau < 0) {
    throw new RangeError('Gain, time constant and natural frequency must be positive. Damping and sensor lag must be nonnegative.');
  }
  if (kp < 0 || ki < 0 || kd < 0) throw new RangeError('PID gains must be nonnegative.');
  if (lower >= upper) throw new RangeError('The upper actuator limit must exceed the lower limit.');
  if (reference === 0 || duration <= 0) throw new RangeError('Use a nonzero step and a positive experiment duration.');
  if (samplePeriod < 0.000001 || samplePeriod > 1800) {
    throw new RangeError('Use a sampling period from 1 microsecond to 30 minutes.');
  }
  // The simulation and the Arduino clock use the same whole-microsecond period.
  settings.samplePeriod = Math.round(samplePeriod * 1e6) / 1e6;
  return settings;
}

function rk4(derivative, state, dt) {
  const addScaled = (slope, scale) => state.map((value, index) => value + scale * slope[index]);
  const a = derivative(state);
  const b = derivative(addScaled(a, dt / 2));
  const c = derivative(addScaled(b, dt / 2));
  const d = derivative(addScaled(c, dt));
  return state.map((value, index) => value + dt * (a[index] + 2*b[index] + 2*c[index] + d[index]) / 6);
}

function clipsFurther(unsaturated, integralChange, { lower, upper, antiWindup }) {
  return antiWindup && ((unsaturated > upper && integralChange > 0)
    || (unsaturated < lower && integralChange < 0));
}

export function digitalUpdate(settings, measured, previousError, integral) {
  const { kp, ki, kd, reference, samplePeriod, lower, upper } = settings;
  const error = reference - measured;
  const change = ki * samplePeriod * error;
  const proportionalAndDerivative = kp * error + kd * (error - previousError) / samplePeriod;
  if (!clipsFurther(proportionalAndDerivative + integral + change, change, settings)) integral += change;
  const raw = proportionalAndDerivative + integral;
  return { error, integral, raw, control: clamp(raw, lower, upper) };
}

function continuousControl(s, y, velocity, measured, integral) {
  const feedback = s.sensorTau ? measured : y;
  const error = s.reference - feedback;
  const base = s.kp * error + integral;
  let raw;
  if (s.sensorTau) {
    raw = base - s.kd * (y - measured) / s.sensorTau;
  } else if (s.plant === 'second') {
    raw = base - s.kd * velocity;
  } else {
    // With direct first-order feedback, y′ depends on u. Solve the algebraic
    // equation for the free command before applying actuator limits.
    raw = (base + s.kd * y / s.tau) / (1 + s.kd * s.gain / s.tau);
  }
  const change = s.ki * error;
  return {
    control: clamp(raw, s.lower, s.upper),
    integralRate: clipsFurther(raw, change, s) ? 0 : change
  };
}

function stepLimit(s) {
  let rate = s.plant === 'first' ? 1 / s.tau : s.omega * (1 + 2 * s.zeta);
  if (s.mode === 'continuous') {
    const coupling = s.plant === 'first' ? s.gain / (s.tau + (s.sensorTau ? 0 : s.gain * s.kd))
      : s.gain * s.omega ** 2;
    rate += s.plant === 'first' ? coupling * s.kp : Math.sqrt(coupling * s.kp);
    rate += s.plant === 'first' ? Math.sqrt(coupling * s.ki) : Math.cbrt(coupling * s.ki);
    if (s.plant === 'second' && !s.sensorTau) rate += coupling * s.kd;
    if (s.sensorTau) rate += Math.sqrt(coupling * s.kd / s.sensorTau);
  }
  if (s.sensorTau) rate += 1 / s.sensorTau;
  return Math.min(0.01, 0.08 / rate);
}

export function simulate(values) {
  const settings = settingsFor(values);
  const s = settings;
  const digital = s.mode === 'digital';
  const maxStep = stepLimit(s);
  const sampleCount = s.duration / s.samplePeriod;
  const lastSample = Math.max(0, Math.ceil(sampleCount - sampleCount * Number.EPSILON) - 1);
  const fullIntervalSteps = Math.ceil(s.samplePeriod / maxStep);
  if (s.duration / maxStep + (digital ? lastSample : 0) > 160_000) {
    throw new RangeError('This run needs too many steps. Shorten the duration or choose less extreme parameters.');
  }

  // State order is plant output, plant velocity, sensor output, integral contribution.
  let state = [0, 0, 0, 0];
  let sampled = { error: 0, integral: 0, raw: 0, control: 0 };
  const derivatives = ([y, velocity, measured, integral]) => {
    const pid = digital ? sampled : continuousControl(s, y, velocity, measured, integral);
    const drive = s.gain * pid.control - y;
    return [
      s.plant === 'first' ? drive / s.tau : velocity,
      s.plant === 'second' ? s.omega ** 2 * drive - 2 * s.zeta * s.omega * velocity : 0,
      s.sensorTau ? (y - measured) / s.sensorTau : 0,
      digital ? 0 : pid.integralRate
    ];
  };

  const points = [];
  const commands = [];
  let time = 0;
  let status = 'ok';
  const record = () => {
    const [output, velocity, sensor, integral] = state;
    const measured = s.sensorTau ? sensor : output;
    const control = digital ? sampled.control : continuousControl(s, output, velocity, sensor, integral).control;
    points.push({ time, output, measured, control, integral: digital ? sampled.integral : integral });
  };

  const intervals = digital ? lastSample + 1 : 1;
  for (let interval = 0; interval < intervals; interval++) {
    if (digital) {
      const feedback = s.sensorTau ? state[2] : state[0];
      const next = digitalUpdate(s, feedback, sampled.error, sampled.integral);
      if (!Object.values(next).every(Number.isFinite)) {
        status = 'diverged';
        break;
      }
      sampled = next;
      commands.push({ time, control: sampled.control });
    }
    if (interval === 0) record();
    const start = time;
    const end = interval === intervals - 1 ? s.duration : (interval + 1) * s.samplePeriod;
    const steps = digital && interval < lastSample ? fullIntervalSteps : Math.ceil((end - start) / maxStep);
    const dt = (end - start) / steps;
    for (let step = 1; step <= steps; step++) {
      state = rk4(derivatives, state, dt);
      if (!state.every(value => Number.isFinite(value) && Math.abs(value) <= 1e10)) {
        status = 'diverged';
        break;
      }
      time = step === steps ? end : start + step * dt;
      record();
    }
    if (status !== 'ok') break;
  }
  if (digital && points.length && time > commands.at(-1).time) commands.push({ time, control: sampled.control });
  const result = { settings, status, points, commands };
  return { ...result, metrics: measure(result) };
}

function crossing(points, project, threshold) {
  for (let index = 1; index < points.length; index++) {
    const next = project(points[index]);
    if (next >= threshold) {
      const before = project(points[index - 1]);
      const fraction = (threshold - before) / (next - before);
      return points[index - 1].time + fraction * (points[index].time - points[index - 1].time);
    }
  }
  return null;
}

export function measure({ settings: s, status, points }) {
  if (status !== 'ok' || points.length < 2) return { state: 'diverged' };
  const desiredInput = s.ki > 0 ? s.reference / s.gain : s.kp * s.reference / (1 + s.gain * s.kp);
  const equilibrium = s.gain * clamp(desiredInput, s.lower, s.upper);
  const excursion = equilibrium - points[0].output;
  const scale = Math.max(Math.abs(excursion), 0.01 * Math.abs(s.reference));
  const tailSeconds = Math.max(Math.min(2, s.duration / 5), s.mode === 'digital' ? 2 * s.samplePeriod : 0);
  const tailStart = s.duration - tailSeconds;
  const tail = points.filter(point => point.time >= tailStart);
  const maxResidual = tail.reduce((max, point) => Math.max(max,
    Math.abs(point.output - equilibrium), Math.abs(point.measured - equilibrium)), 0);
  if (tailStart <= 0 || maxResidual > 0.005 * scale) return { state: 'unsettled' };

  const count = Math.max(1, Math.ceil(tail.length / 2));
  const terminalMean = tail.slice(-count).reduce((sum, point) => sum + point.output, 0) / count;
  const steadyError = s.reference - terminalMean;
  if (!excursion) return { state: 'settled', riseTime: null, overshoot: null, settlingTime: 0, steadyError };
  const fraction = point => (point.output - points[0].output) / excursion;
  const first = crossing(points, fraction, 0.1);
  const last = crossing(points, fraction, 0.9);
  const peak = points.reduce((max, point) => Math.max(max, fraction(point)), 0);
  const outside = points.findLastIndex(point => Math.abs(point.output - equilibrium) > 0.02 * scale);
  let settlingTime = 0;
  if (outside >= 0) {
    const left = points[outside];
    const right = points[outside + 1];
    const from = Math.abs(left.output - equilibrium);
    const to = Math.abs(right.output - equilibrium);
    settlingTime = left.time + (from - 0.02 * scale) / (from - to) * (right.time - left.time);
  }
  return { state: 'settled', riseTime: first === null || last === null ? null : last - first,
    overshoot: Math.max(0, (peak - 1) * 100), settlingTime, steadyError };
}

export function piDynamics({ gain, tau, kp, ki }) {
  if (!ki) return null;
  const omega = Math.sqrt(gain * ki / tau);
  return { omega, zeta: (1 + gain * kp) / (2 * tau * omega) };
}

export const challengeSpec = Object.freeze({ overshoot: 10, settlingTime: 5, errorPercent: 1 });

export function randomPlant(random = Math.random) {
  const gain = 0.9 + random() * 0.4;
  return random() < 0.5
    ? { plant: 'first', gain, tau: 0.55 + random() * 0.55 }
    : { plant: 'second', gain, omega: 1.8 + random(), zeta: 0.45 + random() * 0.3 };
}

export function scoreChallenge(metrics, reference = 1) {
  const settled = metrics.state === 'settled';
  return {
    overshoot: settled && metrics.overshoot !== null && metrics.overshoot <= challengeSpec.overshoot,
    settlingTime: settled && metrics.settlingTime <= challengeSpec.settlingTime,
    errorPercent: settled && 100 * Math.abs(metrics.steadyError / reference) <= challengeSpec.errorPercent
  };
}

export function validation() {
  const sample = { gain: 1, tau: 1, lower: -100, upper: 100, duration: 20 };
  const p = simulate({ ...sample, kp: 9, ki: 0, kd: 0 });
  const piSettings = { ...sample, kp: 1, ki: 1, kd: 0 };
  const pi = simulate(piSettings);
  const timeConstant = crossing(p.points, point => point.output, 0.9 * (1 - Math.exp(-1)));
  const piReferenceError = pi.points.reduce((max, point) =>
    Math.max(max, Math.abs(point.output - (1 - Math.exp(-point.time)))), 0);
  const { omega, zeta } = piDynamics(piSettings);
  return [
    ['P · Closed-loop time constant (s)', 0.1, timeConstant, 0.001],
    ['P · Steady-state error (% of step)', 10, 100*p.metrics.steadyError, 0.05],
    ['PI · Natural frequency (rad/s)', 1, omega, 0.000001],
    ['PI · Damping ratio', 1, zeta, 0.000001],
    ['PI · Max difference from analytic step', 0, piReferenceError, 0.000001],
    ...[[1, 1], [2, 3], [4, 2]].map(([kp, ki], index) => {
      const run = index === 0 ? pi : simulate({ ...sample, kp, ki, duration: 60 });
      return [`PI · Step error (Kp=${kp}, Ki=${ki})`, 0, run.metrics.steadyError, 0.0001];
    })
  ].map(([label, expected, calculated, tolerance]) => ({
    label, expected, calculated, tolerance,
    pass: Number.isFinite(calculated) && Math.abs(calculated - expected) <= tolerance
  }));
}
