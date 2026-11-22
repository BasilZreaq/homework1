const number = value => Number(value.toPrecision(4)).toString();

function tickStep(span, target) {
  const interval = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(interval));
  return [1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= interval) * magnitude;
}

export class Plot {
  constructor(canvas, { legend, readout, unit, dark = false }) {
    this.canvas = canvas;
    this.legend = legend;
    this.readout = readout;
    this.unit = unit;
    this.dark = dark;
    this.traces = [];
    new ResizeObserver(() => this.draw()).observe(canvas);
    if (readout) {
      canvas.addEventListener('pointermove', event => {
        this.hover = event.offsetX;
        this.draw();
      });
      canvas.addEventListener('pointerleave', () => {
        this.hover = null;
        this.draw();
      });
    }
  }

  update(traces, unit = this.unit) {
    this.traces = traces;
    this.unit = unit;
    this.hover = null;
    if (this.legend) this.legend.replaceChildren(...traces.map(({ label, color, dash }) => {
      const item = document.createElement('li');
      const swatch = document.createElement('i');
      swatch.style.borderColor = color;
      if (dash) swatch.style.borderTopStyle = 'dashed';
      item.append(swatch, label);
      return item;
    }));
    this.draw();
  }

  draw() {
    const { canvas, traces, dark } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this.readout) this.readout.textContent = '';
    if (!traces.length || !traces[0].points.length) return;

    const left = width < 400 ? 55 : 66;
    const right = width - 15;
    const top = 20;
    const bottom = height - 40;
    let high = 0;
    let low = 0;
    let duration = 0;
    for (const trace of traces) {
      duration = Math.max(duration, trace.points.at(-1)?.time ?? 0);
      for (const point of trace.points) {
        const value = point[trace.key];
        high = Math.max(high, value);
        low = Math.min(low, value);
      }
    }
    const margin = 0.09 * (high - low || 1);
    high += margin;
    low -= margin;
    duration ||= 1;
    const verticalStep = tickStep(high - low, 5);
    const lowestTick = Math.ceil(low / verticalStep);
    const highestTick = Math.floor(high / verticalStep);
    const horizontalStep = tickStep(duration, width < 400 ? 4 : 7);
    const x = time => left + (right - left) * time / duration;
    const y = value => bottom - (bottom - top) * (value - low) / (high - low);
    const grid = dark ? '#3b555b' : '#dce7e3';
    const ink = dark ? '#c4dddb' : '#4c6468';
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    ctx.font = '12px Consolas, monospace';
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = ink;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let tick = lowestTick; tick <= highestTick; tick++) {
      const val = tick * verticalStep;
      line(left, y(val), right, y(val));
      ctx.fillText(number(val), left - 6, y(val), left - 8);
    }
    ctx.textAlign = 'center';
    for (let tick = 0; tick <= Math.floor(duration / horizontalStep); tick++) {
      const time = horizontalStep * tick;
      line(x(time), top, x(time), bottom);
      ctx.fillText(number(time), x(time), bottom + 11);
    }
    ctx.fillText('Time (s)', (left + right) / 2, height - 9);
    ctx.textAlign = 'left';
    ctx.fillText(this.unit, left, 8, right - left);

    for (const trace of traces) {
      ctx.strokeStyle = trace.color;
      ctx.lineWidth = trace.width ?? 2;
      ctx.setLineDash(trace.dash ? [6, 4] : []);
      ctx.beginPath();
      let previous;
      for (const point of trace.points) {
        const pos = x(point.time);
        const value = y(point[trace.key]);
        if (!previous) ctx.moveTo(pos, value);
        else {
          if (trace.step) ctx.lineTo(pos, previous.value);
          ctx.lineTo(pos, value);
        }
        previous = { value };
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (this.hover == null || this.hover < left || this.hover > right) return;
    const time = (this.hover - left) * duration / (right - left);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    line(this.hover, top, this.hover, bottom);
    this.readout.textContent = [`${time.toFixed(2)} s`, ...traces.flatMap(trace => {
      const value = valueAt(trace, time);
      return value == null ? [] : [`${trace.label} ${number(value)}`];
    })].join(' · ');
  }
}

function valueAt({ points, key, step }, time) {
  if (time > points.at(-1)?.time || !points.length) return null;
  let left = 0;
  let right = points.length - 1;
  while (right - left > 1) {
    const middle = (left + right) >> 1;
    if (points[middle].time <= time) left = middle;
    else right = middle;
  }
  const a = points[left];
  const b = points[right];
  if (time === b.time) return b[key];
  if (step || b.time === a.time) return a[key];
  return a[key] + (b[key] - a[key]) * (time - a.time) / (b.time - a.time);
}
