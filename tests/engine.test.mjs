import assert from 'node:assert/strict';
import test from 'node:test';
import { digitalUpdate, randomPlant, scoreChallenge, settingsFor, simulate, validation } from '../control/engine.mjs';

test('all homework reference checks pass at the displayed tolerances', () => {
  const checks = validation();
  assert.equal(checks.length, 8);
  for (const row of checks) assert.ok(row.pass, JSON.stringify(row));
});

test('second-order P response agrees with its underdamped analytic model', () => {
  const s = { plant: 'second', gain: 1, omega: 2, zeta: 0.5, kp: 1, ki: 0, kd: 0 };
  const result = simulate(s);
  const alpha = s.zeta * s.omega;
  const beta = Math.sqrt(s.omega ** 2 * (1 + s.gain * s.kp) - alpha ** 2);
  for (const { time, output } of result.points) {
    const expected = 0.5 * (1 - Math.exp(-alpha * time)
      * (Math.cos(beta * time) + alpha / beta * Math.sin(beta * time)));
    assert.ok(Math.abs(output - expected) < 1e-7);
  }
});

test('sensor measurement feeds the PID and slower lag increases overshoot', () => {
  const s = { kp: 1.7, ki: 9, duration: 24 };
  const ideal = simulate(s);
  const fast = simulate({ ...s, sensorTau: 0.04 });
  const medium = simulate({ ...s, sensorTau: 0.23 });
  const slow = simulate({ ...s, sensorTau: 1.2 });
  const transient = slow.points.find(point => point.time >= 0.4);
  assert.ok(transient.output > transient.measured + 0.3);
  assert.ok(Math.abs(transient.control - s.kp * (1 - transient.measured) - transient.integral) < 1e-10);
  assert.ok(medium.metrics.overshoot > fast.metrics.overshoot + 30);
  assert.ok(fast.metrics.overshoot > ideal.metrics.overshoot);
  assert.equal(slow.metrics.state, 'unsettled');
  assert.equal(slow.metrics.overshoot, undefined);
  const tail = slow.points.filter(point => point.time > 12).map(point => point.output);
  assert.ok(Math.max(...tail) - Math.min(...tail) > 3);
});

test('continuous derivative uses the actual measurement slope through an actuator limit', () => {
  const { points } = simulate({ kp: 2, ki: 0, kd: 1 });
  assert.equal(points[0].control, 1);
  const tick = points.find(point => point.time >= 0.2);
  assert.ok(Math.abs(tick.control - (2 * (1 - tick.output) - (tick.control - tick.output))) < 1e-12);
  assert.equal(simulate({ kp: 2, ki: 0, kd: 1, upper: 0.8 }).points[0].control, 0.8);
});

test('digital PID integrates e[0], differentiates against e[-1] and holds until the next tick', () => {
  const s = { mode: 'digital', samplePeriod: 0.137, kp: 2, ki: 3, kd: 0.25, duration: 1.01,
    lower: -100, upper: 100, antiWindup: false };
  const { points, commands } = simulate(s);
  const first = 2 + 3 * s.samplePeriod + 0.25 / s.samplePeriod;
  assert.ok(Math.abs(commands[0].control - first) < 1e-12);
  assert.ok(Math.abs(points.find(point => point.time === s.samplePeriod).output
    - first * (1 - Math.exp(-s.samplePeriod))) < 1e-8);
  const indexed = commands.slice(0, -1);
  assert.equal(indexed.length, Math.ceil(s.duration / s.samplePeriod));
  for (const [index, { time, control }] of indexed.entries()) {
    assert.equal(time, index * s.samplePeriod);
    for (const point of points.filter(point => point.time > time && point.time < time + s.samplePeriod - 1e-10)) {
      assert.equal(point.control, control);
    }
  }
  assert.equal(commands.at(-1).time, s.duration);
});

test('conditional anti-windup works on both limit signs and permits unwinding', () => {
  const s = settingsFor({ mode: 'digital', ki: 4, kp: 2, samplePeriod: .25, lower: -1, upper: 1 });
  assert.equal(digitalUpdate(s, 0, 0, 0).integral, 0);
  assert.equal(digitalUpdate(s, 2, 0, 0).integral, 0);
  assert.equal(digitalUpdate(s, 2, 0, 10).integral, 9);
  assert.equal(digitalUpdate({ ...s, antiWindup: false }, 0, 0, 0).integral, 1);
  const demo = { mode: 'digital', kp: 3.4, ki: 5, kd: 0, lower: 0, upper: 1.22, samplePeriod: .08 };
  const protectedRun = simulate(demo);
  const unprotectedRun = simulate({ ...demo, antiWindup: false });
  assert.ok(unprotectedRun.metrics.overshoot > protectedRun.metrics.overshoot + 15);
  for (const run of [protectedRun, unprotectedRun]) {
    assert.ok(run.commands.every(point => point.control >= demo.lower && point.control <= demo.upper));
  }
});

test('continuous actuator saturation and integral conditioning produce the reachable output', () => {
  const s = { kp: 4, ki: 3, upper: .5, lower: 0 };
  const protectedRun = simulate(s);
  const unprotectedRun = simulate({ ...s, antiWindup: false });
  assert.ok(protectedRun.points.every(point => point.control <= .5 && point.control >= 0));
  assert.equal(protectedRun.points.at(-1).integral, 0);
  assert.ok(unprotectedRun.points.at(-1).integral > 10);
  assert.ok(Math.abs(protectedRun.metrics.steadyError - .5) < 1e-6);
});

test('metrics are withheld for slow convergence, persistent oscillation and numerical divergence', () => {
  for (const settings of [{ duration: .1 }, { mode: 'digital', samplePeriod: .9, kp: 2.4, ki: 1.8, kd: .15 },
    { plant: 'second', zeta: 0, kp: 0, ki: 5 }]) {
    assert.deepEqual(simulate(settings).metrics, { state: 'unsettled' });
  }
  const result = simulate({ mode: 'digital', kp: 1e300, reference: 1e100 });
  assert.deepEqual(result.metrics, { state: 'diverged' });
  assert.equal(result.commands.length, 0);
});

test('handles negative steps, zero gains and invalid parameter combinations', () => {
  const result = simulate({ kp: 9, ki: 0, lower: -12, reference: -1 });
  assert.ok(Math.abs(result.metrics.steadyError + .1) < 1e-8);
  const zero = simulate({ kp: 0, ki: 0, kd: 0 });
  assert.equal(zero.metrics.steadyError, 1);
  assert.equal(zero.metrics.riseTime, null);
  for (const invalid of [{ tau: 0 }, { omega: 0 }, { zeta: -1 }, { gain: 0 }, { reference: 0 },
    { sensorTau: -1 }, { kd: NaN }, { lower: 5, upper: 5 }, { samplePeriod: 0 },
    { duration: Infinity }, { plant: 'third' }, { mode: 'digital', samplePeriod: 1e-6 }]) {
    assert.throws(() => simulate(invalid), RangeError);
  }
});

test('challenge rules are deterministic and representative hidden plants can pass', () => {
  for (const coordinates of [[0, 0, .999], [.999, 0, 0], [0, .999, 0, 0], [.999, .999, .999, .999]]) {
    const plant = randomPlant(() => coordinates.shift());
    const values = { ...plant, kp: 2, ki: 2, kd: 0.5, duration: 20 };
    const first = scoreChallenge(simulate(values).metrics);
    assert.deepEqual(first, { overshoot: true, settlingTime: true, errorPercent: true });
    assert.deepEqual(first, scoreChallenge(simulate(values).metrics));
  }
  assert.deepEqual(scoreChallenge({ state: 'unsettled' }), { overshoot: false, settlingTime: false, errorPercent: false });
});
