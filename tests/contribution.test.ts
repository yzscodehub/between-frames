import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CONTRIBUTION_DOMAIN, CONTRIBUTION_PRESETS, evaluateContribution} from '../src/lib/contribution';

test('fixed visibility has one measure while normal rotation changes the cosine contribution', () => {
  const away = evaluateContribution(-60, 1);
  const toward = evaluateContribution(45, 1);
  assert.equal(away.measure, toward.measure);
  assert.ok(toward.exact > away.exact * 3);
  // Independently integrate the non-cosine measure over the fixed interval.
  const {low, high} = CONTRIBUTION_DOMAIN;
  const steps = 20000, dt = (high - low) / steps;
  let measure = 0;
  for (let i = 0; i < steps; i++) measure += Math.abs(Math.sin(low + (i + .5) * dt)) * dt;
  assert.ok(Math.abs(away.measure - measure) < 1e-8);
});

test('all controls and presets agree with independent direct quadrature, including clipped directions', () => {
  const settings = [...CONTRIBUTION_PRESETS, ...[-75, -25, 0, 20, 75].flatMap(gamma => [.1, .5, 1].map(length => ({gamma, length})))];
  for (const {gamma, length} of settings) {
    const result = evaluateContribution(gamma, length);
    assert.ok(result.error < 3e-8, `${gamma}°, length ${length}: ${result.error}`);
    assert.ok(result.exact >= 0 && result.exact <= result.measure * length);
  }
});

test('projection length scales weighted contribution without changing visible measure', () => {
  const full = evaluateContribution(45, 1), half = evaluateContribution(45, .5);
  assert.equal(half.measure, full.measure);
  assert.equal(half.exact, full.exact / 2);
  assert.equal(half.numeric, full.numeric / 2);
});
