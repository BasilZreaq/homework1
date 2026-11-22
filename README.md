# ENCS4380 — Dynamic Characteristics & PID Control Toolkit

Birzeit University · Interfacing Techniques

Instructor: Dr. Wasel Ghanem

## Overview

The toolkit connects sensor dynamics to closed-loop control. Homework 1 explores how sensors respond to steps, ramps, and sinusoids. Homework 2 uses those plant models to study PID tuning, feedback lag, sampled control, and actuator limits. The static site runs in a browser.

## Project Links

- [Live toolkit](https://basilzreaq.github.io/homework1/)
- [Source repository](https://github.com/BasilZreaq/homework1)
- [Maintenance release v2.0.1](https://github.com/BasilZreaq/homework1/releases/tag/v2.0.1) and [Homework 2 release v2.0](https://github.com/BasilZreaq/homework1/releases/tag/v2.0)

## Homework 1 — Dynamic Characteristics

| Module | Experiment | Contributor |
| --- | --- | --- |
| [1 — First-Order Time Response](https://basilzreaq.github.io/homework1/module1.html) | Step and ramp response, time constant, and error | Basil |
| [2 — First-Order Frequency Response](https://basilzreaq.github.io/homework1/ahmad_index.html) | Sinusoidal response, Bode plots, phase lag, and dynamic error | Ahmad |
| [3 — Second-Order Response](https://basilzreaq.github.io/homework1/Module3-Majd.html) | Damping, poles, and mass–spring–damper state space | Majd |
| [4 — Guess the Sensor](https://basilzreaq.github.io/homework1/Module4_GuessTheSensor_Zaid.html) | Estimate a hidden sensor model from noisy measurements | Zaid |

## Homework 2 — PID Control

| Module | Experiment | Issue |
| --- | --- | --- |
| [P1 — PID Playground](https://basilzreaq.github.io/homework1/control/?lab=p1) | Tune continuous PID on first- and second-order plants | [#1](https://github.com/BasilZreaq/homework1/issues/1) |
| [P2 — Slow Sensor](https://basilzreaq.github.io/homework1/control/?lab=p2) | Compare true and measured output as feedback lag increases | [#2](https://github.com/BasilZreaq/homework1/issues/2) |
| [P3 — Digital PID](https://basilzreaq.github.io/homework1/control/?lab=p3) | Compare sample periods and anti-windup, and generate Arduino code | [#3](https://github.com/BasilZreaq/homework1/issues/3) |
| [P4 — Tuning Challenge](https://basilzreaq.github.io/homework1/control/?lab=p4) | Tune a hidden plant for ≤10% overshoot, ≤5 s settling, and ≤1% absolute step error | [#4](https://github.com/BasilZreaq/homework1/issues/4) |
| [My System](https://basilzreaq.github.io/homework1/control/?lab=system) | Specify a first-order plant and compare a normalized PI reference with RK4 | |
| [Numerical Validation](https://basilzreaq.github.io/homework1/control/?lab=validation) | Compare the homework cases and PI reference with analytical values | |

## Main Features

- Each Control lab P1–P4 pairs interactive plots with a Predict, then check activity.
- The simulator displays setpoint, output, actuator command, and limits. With the plot focused, the arrow keys inspect values along the curve.
- My System records plant parameters, units, source, and engineering rationale. Browser-saved settings can be loaded in P1–P3. Its initial plant values are illustrative.
- Drive-motor mode fixes the command at 0–100% PWM. For a continuous PI design, the lab displays the reference damping ratio against the 0.6–0.8 target.
- The Arduino sketch uses the selected gains, limits, sample period, and anti-windup setting. Calibrated sensor, actuator, and stop functions depend on the hardware.

![PID Playground showing the closed-loop step response](control/playground.png)

[Homework 1 step-response screenshot](image.png) · [Homework 1 ramp-response screenshot](image-1.png)

## Mathematical Models

| Component | Equation or implementation |
| --- | --- |
| First-order plant | τẏ = Ku − y and G(s) = K/(τs + 1) |
| Second-order plant | ẏ = v and v̇ = ωₙ²(Ku − y) − 2ζωₙv |
| Sensor and feedback | τₛẏₘ = y − yₘ and e = r − yₘ. At τₛ = 0, yₘ = y. |
| Continuous PID | P and I act on e. The derivative acts on the measurement to avoid a setpoint impulse. RK4 advances the dynamic states. |
| Digital PID | u[k] = Kp·e[k] + Ki·Tₛ·Σe[j] + Kd·(e[k] − e[k−1])/Tₛ, summed from j = 0 to k, with e[−1] = 0. |
| Actuator | The command is limited to the configured range and held between digital updates. Conditional anti-windup skips integral increments that push farther into saturation. |

Rise time uses the 10–90% crossings of the reachable equilibrium excursion. Overshoot and settling use that equilibrium, with a 2% settling band. Steady-state error compares the setpoint with the simulated terminal mean and is reported as a percentage of the step magnitude. The metrics require a converged simulation tail.

## Running the Project

From the repository root, start a static server with Python 3, then open [localhost:8000](http://localhost:8000/).

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Homework 1 uses [Plotly.js](https://plotly.com/javascript/) and [Chart.js](https://www.chartjs.org/docs/) from a CDN. The Control labs use browser-native JavaScript and Canvas.

## Validation and Testing

The validation page shows calculated results, reference values, and absolute tolerances.

| Case | Result | Absolute tolerance |
| --- | --- | --- |
| P-only, Kp = 9 | Time constant 0.10008 s and 10% step error | 0.001 s and 0.05 percentage points |
| PI, Kp = Ki = 1 | ωₙ = 1 rad/s and ζ = 1 | 10⁻⁶ each |
| Stable, unsaturated PI | Maximum terminal error across three cases of 3.54 × 10⁻⁹ model units | 10⁻⁴ model units |
| PI reference, Kp = 1.8 and Ki = 4 | ωₙ = 2 rad/s, ζ = 0.7, 0.66475 s rise, 9.5308% overshoot, 2.56589 s settling | 10⁻⁹ for ωₙ and ζ, 0.001 s for rise and settling, 0.01 percentage points for overshoot |
| PI reference step curve | Maximum analytical–RK4 difference of 6.98 × 10⁻¹⁰ model units | 10⁻⁶ model units |

The reference transfer function is (1.8s + 4)/(s² + 2.8s + 4). Its numerator zero affects the step response. When command limits constrain the actuator, metrics use the resulting simulated output.

Run the simulation tests with Node.js 22 or higher. The Arduino test uses a C++ compiler such as GCC and checks command parity, sample timing, clock rollover, and invalid sensor readings against stub hardware.

```sh
node --test tests/engine.test.mjs
node --test tests/arduino.test.mjs
```

The browser suite checks navigation, plots, mobile layout, and clipboard behavior. Install Playwright and Chromium with PowerShell.

```powershell
npm install --prefix .test-tools --no-save playwright
$env:PLAYWRIGHT_MODULE = "$PWD/.test-tools/node_modules/playwright"
& "$PWD/.test-tools/node_modules/.bin/playwright.cmd" install chromium
node --test tests/browser.test.mjs
```

Set `BROWSER_PATH` to use an installed Chromium or Edge executable. Set `TOOLKIT_BASE_URL` to a site URL ending in `/` to run the same browser checks against a deployment.

## Team Members

[Basil](https://github.com/BasilZreaq) · [Ahmad](https://github.com/ahmadd923) · [Majd](https://github.com/majdds) · [Zaid](https://github.com/zaidrasras31)

## AI Usage

Homework 1 used AI assistance for initial Module 1 development, styling, and JavaScript organization. For Homework 2, OpenAI Codex assisted with implementation, debugging, testing, integration, documentation, and the analytical comparison of the PI reference. The project team is responsible for reviewing the implementation, explaining the control models, and validating the engineering results.
