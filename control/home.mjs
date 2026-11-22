import { simulate } from './engine.mjs';
import { Plot } from './plot.mjs';

const run = simulate({ kp: 1, ki: 1, duration: 6 });
const plot = new Plot(document.getElementById('hero-plot'), {
  legend: document.getElementById('hero-legend'), unit: 'Normalized output', dark: true
});
plot.update([
  { label: 'Setpoint', color: '#cfaf77', dash: true, key: 'output',
    points: [{ time: 0, output: 1 }, { time: 6, output: 1 }] },
  { label: 'PI step response', color: '#a7e8cb', width: 3, key: 'output', points: run.points }
]);
