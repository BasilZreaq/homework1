import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arduinoSketch } from '../control/arduino.mjs';
import { digitalUpdate, settingsFor } from '../control/engine.mjs';

test('generated C++ compiles and matches discrete PID, limits and scheduler ticks', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('./.arduino-', import.meta.url)));
  const header = join(directory, 'Arduino.h');
  const source = join(directory, 'sketch.cpp');
  const executable = join(directory, process.platform === 'win32' ? 'sketch.exe' : 'sketch');
  const compiler = process.env.CXX || 'g++';
  const measured = [0, 0.2, 0.8, 1.1, 1.4, 0.6, 0.4, 1.8];
  try {
    writeFileSync(header, `
#include <cstdint>
#include <cmath>
using std::isfinite;
extern uint32_t simulatedMicros;
extern float simulatedMeasurement;
extern float actuation;
extern unsigned writes;
extern unsigned stops;
inline uint32_t micros() { return simulatedMicros; }
inline float constrain(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }
`);
    for (const antiWindup of [true, false]) {
      const settings = settingsFor({ mode: 'digital', kp: 1, ki: 1.23, kd: .08,
        samplePeriod: .125, lower: 0, upper: 1, antiWindup });
      const sketch = arduinoSketch(settings).replace('return NAN;', 'return simulatedMeasurement;')
        .replace('(void) command;', 'actuation = command; ++writes;')
        .replace("// Implement your hardware's stop action here.", '++stops;');
      writeFileSync(source, `${sketch}
#include <iostream>
uint32_t simulatedMicros = UINT32_MAX - SAMPLE_US / 2;
float simulatedMeasurement = 0;
float actuation = 0;
unsigned writes = 0;
unsigned stops = 0;
int main() {
  setup();
  float measured[] = { ${measured.join(', ')} };
  for (unsigned i = 0; i < sizeof(measured) / sizeof(measured[0]); ++i) {
    simulatedMeasurement = measured[i];
    loop();
    if (writes != i + 1 || stops != 0) return 1;
    std::cout.precision(9);
    std::cout << actuation << '\\n';
    simulatedMicros += SAMPLE_US - 1;
    loop();
    if (writes != i + 1) return 2;
    ++simulatedMicros;
  }
  simulatedMeasurement = NAN;
  loop();
  if (stops != 1 || integralTerm != 0.0f || previousError != 0.0f) return 3;
}
`);
      const compile = spawnSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror',
        '-I', directory, source, '-o', executable], { encoding: 'utf8' });
      assert.equal(compile.status, 0, compile.error?.message ?? compile.stderr);
      const run = spawnSync(executable, [], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      let state = { error: 0, integral: 0 };
      const expected = measured.map(value => {
        state = digitalUpdate(settings, value, state.error, state.integral);
        return state.control;
      });
      const actual = run.stdout.trim().split(/\r?\n/).map(Number);
      assert.equal(actual.length, expected.length);
      for (const [index, value] of actual.entries()) {
        assert.ok(Math.abs(value - expected[index]) < 3e-6, `Tick ${index}: ${value} vs ${expected[index]}`);
      }
    }
  } finally {
    for (const path of [executable, source, header]) {
      try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rmdirSync(directory);
  }
});
