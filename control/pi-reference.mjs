import { piDynamics, simulate } from './engine.mjs';

export const piReference = Object.freeze({
  plant: 'first', gain: 1, tau: 1, kp: 1.8, ki: 4, kd: 0, reference: 1,
  lower: -100, upper: 100, duration: 12, mode: 'continuous'
});

function zeroBetween(fn, left, right) {
  const initialSign = Math.sign(fn(left));
  for (let step = 0; step < 45; step++) {
    const middle = (left + right) / 2;
    if (Math.sign(fn(middle)) === initialSign) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}

export function comparePIReference() {
  // Y(s)/R(s) = (1.8s + 4)/(s² + 2.8s + 4). For a unit step,
  // E(s) = (s + 1)/(s² + 2.8s + 4). Keep the numerator zero in the solution.
  const decay = 2.8 / 2;
  const naturalFrequency = Math.sqrt(4);
  const dampingRatio = decay / naturalFrequency;
  const dampedFrequency = Math.sqrt(naturalFrequency ** 2 - decay ** 2);
  const sineWeight = (1 - decay) / dampedFrequency;
  const output = time => 1 - Math.exp(-decay * time) *
    (Math.cos(dampedFrequency * time) + sineWeight * Math.sin(dampedFrequency * time));

  // The first peak is the first positive zero of y′(t). Each subsequent
  // extremum shrinks by exp(−decay * π/dampedFrequency).
  const peakTime = Math.atan2(decay - sineWeight * dampedFrequency,
    -(dampedFrequency + decay * sineWeight)) / dampedFrequency;
  const nextExtremum = peakTime + Math.PI / dampedFrequency;
  const riseTime = zeroBetween(time => output(time) - 0.9, 0, peakTime)
    - zeroBetween(time => output(time) - 0.1, 0, peakTime);
  const overshoot = 100 * (output(peakTime) - 1);
  const settlingTime = zeroBetween(time => output(time) - 1.02, peakTime, nextExtremum);
  const run = simulate(piReference);
  const poles = piDynamics(piReference);
  const values = run.metrics;
  const peakCommand = run.points.reduce((peak, point) => Math.max(peak, Math.abs(point.control)), 0);
  const curveError = run.points.reduce((peak, point) =>
    Math.max(peak, Math.abs(point.output - output(point.time))), 0);
  const rows = [
    ['Natural frequency (rad/s)', naturalFrequency, poles.omega, 1e-9],
    ['Damping ratio', dampingRatio, poles.zeta, 1e-9],
    ['Rise time, 10–90% (s)', riseTime, values.riseTime, 0.001],
    ['Overshoot (%)', overshoot, values.overshoot, 0.01],
    ['Settling time, 2% (s)', settlingTime, values.settlingTime, 0.001],
    ['Steady-state error (%)', 0, 100 * values.steadyError, 0.001],
    ['Maximum step curve difference', 0, curveError, 1e-6]
  ].map(([label, expected, calculated, tolerance]) => ({
    label, expected, calculated, tolerance,
    pass: Number.isFinite(calculated) && Math.abs(calculated - expected) <= tolerance
  }));

  return {
    rows, peakCommand, nextExtremumError: Math.abs(output(nextExtremum) - 1)
  };
}
