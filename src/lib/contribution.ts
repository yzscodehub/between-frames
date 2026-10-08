import {numericalSlice, sliceIntegral} from './math';

export const DEG = Math.PI / 180;
/** Visibility stays fixed while the projected normal changes. */
export const CONTRIBUTION_DOMAIN = {low: -25 * DEG, high: 80 * DEG};
export const CONTRIBUTION_STEPS = 8192;
export const CONTRIBUTION_PRESETS = [
  {label: '① 背离开口', gamma: -60, length: 1},
  {label: '② 朝向开口', gamma: 45, length: 1},
  {label: '③ 投影减半', gamma: 45, length: .5},
] as const;

export function contributionWeight(theta: number, gamma: number, length: number) {
  return length * Math.max(0, Math.cos(theta - gamma)) * Math.abs(Math.sin(theta));
}

export function evaluateContribution(gammaDegrees: number, length: number) {
  const gamma = gammaDegrees * DEG;
  const {low, high} = CONTRIBUTION_DOMAIN;
  // This fixed interval straddles zero. Both quantities use the same |sin θ|
  // measure, but only C includes the normal-dependent cosine and projection.
  const measure = 2 - Math.cos(low) - Math.cos(high);
  const exact = sliceIntegral(gamma, low, high, length);
  // Independent midpoint quadrature evaluates the integrand directly; it does
  // not reuse the primitive or the analytic hemisphere clipping operation.
  const numeric = numericalSlice(gamma, low, high, length, CONTRIBUTION_STEPS);
  return {gamma, measure, exact, numeric, error: Math.abs(exact - numeric)};
}
