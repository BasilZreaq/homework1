import { settingsFor } from './engine.mjs';

export function arduinoSketch(values, { pwm = false } = {}) {
  const s = settingsFor({ ...values, mode: 'digital' });
  return `#include <Arduino.h>
#include <math.h>

// Replace the hardware stubs below with your project's calibrated I/O.
constexpr float KP = ${Number(s.kp)}f;
constexpr float KI = ${Number(s.ki)}f;
constexpr float KD = ${Number(s.kd)}f;
constexpr float SETPOINT = ${Number(s.reference)}f;
constexpr float LOWER_LIMIT = ${Number(s.lower)}f;
constexpr float UPPER_LIMIT = ${Number(s.upper)}f;
constexpr uint32_t SAMPLE_US = ${Math.round(s.samplePeriod * 1e6)}UL;
constexpr float TS = SAMPLE_US / 1000000.0f;
constexpr bool ANTI_WINDUP = ${s.antiWindup};

uint32_t sampleClock = 0;
float integralTerm = 0.0f;
float previousError = 0.0f;  // e[-1] = 0 matches the simulator.

void beginHardware() {
  // Configure the actual sensor and actuator here.
}

float readMeasurement() {
  // Return a measurement in the same units as SETPOINT.
  return NAN;  // Keep the controller inactive until I/O is implemented.
}

void writeCommand(float command) {
  // ${pwm ? 'Convert this 0–100% duty command to the scale of your motor driver.' : 'Convert this command from model units to the actuator interface.'}
  (void) command;
}

void stopActuator() {
  // Implement your hardware's stop action here.
}

float pidStep(float measured) {
  const float error = SETPOINT - measured;
  const float deltaIntegral = KI * TS * error;
  const float pd = KP * error + KD * (error - previousError) / TS;
  const float candidate = pd + integralTerm + deltaIntegral;
  const bool drivesFurtherIntoLimit =
      (candidate > UPPER_LIMIT && deltaIntegral > 0.0f) ||
      (candidate < LOWER_LIMIT && deltaIntegral < 0.0f);
  if (!ANTI_WINDUP || !drivesFurtherIntoLimit) {
    integralTerm += deltaIntegral;
  }
  previousError = error;
  const float raw = pd + integralTerm;
  return constrain(raw, LOWER_LIMIT, UPPER_LIMIT);
}

void setup() {
  beginHardware();
  sampleClock = micros() - SAMPLE_US;  // Sample immediately.
}

void loop() {
  const uint32_t now = micros();
  const uint32_t elapsed = now - sampleClock;  // Unsigned subtraction handles rollover.
  if (elapsed < SAMPLE_US) return;  // Hardware holds the last command.
  // Preserve the schedule. Skip missed ticks instead of replaying stale reads.
  sampleClock += (elapsed / SAMPLE_US) * SAMPLE_US;
  const float measured = readMeasurement();
  if (!isfinite(measured)) {
    previousError = 0.0f;
    integralTerm = 0.0f;
    stopActuator();
    return;
  }
  writeCommand(pidStep(measured));
}
`.replace(/( = )(-?\d+)f;/g, '$1$2.0f;');
}
