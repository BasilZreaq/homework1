# ENCS4380 Homework 2 Demo Guide

The Control labs show how a feedback controller changes the response of a plant. During the demo, make a prediction, change one setting, and explain what the plots and metrics show.

## Ten-minute walkthrough

| Time | What to show | What to explain |
| --- | --- | --- |
| 0:00–2:00 | P1. Switch from **P only** to **PI tracking**, then open **PID damping**. | The controller uses the error e = r − yₘ. P reacts to present error. I accumulates error and can remove a constant offset in a stable loop with enough actuator authority. D reacts to a rate of change and can reduce overshoot. |
| 2:00–3:30 | P2. Apply **Fast sensor**, **Overshoot**, and **Oscillation**. | The feedback signal is the measured output yₘ. Increasing τₛ increases lag. The controller can continue pushing after the true output has crossed the target. |
| 3:30–5:30 | P3. Compare **Fast sampling** and **Slow sampling**, then apply **Windup test**. | The controller updates every Tₛ seconds and holds the command between ticks. Long holds can degrade a fast loop. Anti-windup limits integral buildup when the actuator is already saturated. Open the generated sketch and identify the clock, error terms, and command clamp. |
| 5:30–7:00 | P4. Start a challenge, tune the gains, and compare the three targets. | The plant is random and stays fixed during a round. The score comes from simulated overshoot, settling time, and absolute step error. |
| 7:00–9:00 | My System. Open the continuous PI reference and follow its link to P1. Reduce the command range to 0–1.05 and compare the metrics. | K is output change per unit command. τ is the time to reach 63.2% of the final change for a first-order step. The normalized reference is illustrative. A project model uses measured or cited parameters in physical units. |
| 9:00–10:00 | Open **Numerical Validation**. | Compare the P-only time constant and offset, the assignment PI pole values, and the maximum analytical–RK4 difference for the project reference. |

## Reading a response plot

**Rise time** is the time from 10% to 90% of the final excursion. **Overshoot** is the peak above that excursion, expressed as a percentage. **Settling time** is the time after which the response stays inside the 2% band around equilibrium. **Steady-state error** is the difference between the setpoint and the terminal output. A finite run that has yet to settle cannot establish these final-value metrics.

## Implementation

The first-order plant obeys τẏ = Ku − y. The second-order model integrates output and velocity. With sensor lag, the solver also advances τₛẏₘ = y − yₘ. RK4 estimates the state slope at the start, twice at the midpoint, and at the end of each integration step, then combines the estimates with weights 1, 2, 2, and 1. In digital mode the simulator splits integration at each sample boundary and holds the actuator command within the interval.

For ideal continuous PI with K = τ = 1, Kp = 1.8, and Ki = 4, the characteristic polynomial is s² + 2.8s + 4. Comparing it with s² + 2ζωₙs + ωₙ² gives ωₙ = 2 rad/s and ζ = 0.7. The closed-loop numerator 1.8s + 4 changes the step shape. The ideal response rises in 0.665 s, overshoots by 9.53%, and settles in 2.566 s. With limits of 0–1.05 the simulated rise is about 1.852 s and overshoot is about 0.545%.

The Arduino sketch implements the same discrete integral increment, backward difference, saturation, and conditional integration as the simulator. The scheduler uses elapsed microseconds to identify the next tick. The sensor and actuator functions connect those calculations to calibrated hardware.

## Likely questions

| Question | Answer |
| --- | --- |
| Why does P-only control leave an offset? | The plant needs a sustained input. With P alone, a nonzero error produces that effort. For K = 1 and Kp = 9, the unit-step error is 1/(1 + 9) = 0.1. |
| Why can PI track the step with zero error? | The integral term stores the constant command needed at equilibrium. The loop must be stable and the setpoint reachable with the available actuator range. |
| Why do P1 and P3 treat D differently? | P1 differentiates the measurement to avoid an ideal impulse when the setpoint changes. P3 uses the assignment's sampled difference of errors, so abrupt setpoint changes can produce a derivative kick. |
| Why does a slow sensor cause overshoot? | The plant may already be near or above the setpoint while the measured value still lags, so the controller keeps commanding additional effort. |
| How does anti-windup recover after saturation? | It skips a candidate integral increment that pushes the command farther into a limit and allows increments that move it back. |
| Why can two plants with the same damping ratio have different overshoot? | Damping describes the poles. Zeros, actuator limits, initial conditions, and the input can also shape the response. |
| How would you get motor K and τ? | Apply a PWM step, log speed with the encoder, divide the final speed change by the PWM change to estimate K, and measure the time to 63.2% of that speed change to estimate τ. |
| What does the reference validate? | Agreement between the numerical model and analytically known behavior. Motor performance requires a measured or cited plant model and hardware tests. |
