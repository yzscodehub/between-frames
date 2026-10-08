export const PI = Math.PI;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Integral of cos(theta-gamma) sin(theta), on the positive half of a slice. */
export function primitive(theta: number, gamma: number): number {
  return -Math.cos(gamma) * Math.cos(theta) ** 2 / 2
    + Math.sin(gamma) * (theta / 2 - Math.sin(2 * theta) / 4);
}
export function sliceIntegral(gamma: number, low: number, high: number, length = 1): number {
  const a = Math.max(low, gamma - PI / 2), b = Math.min(high, gamma + PI / 2);
  if (a >= b || length < 1e-8) return 0;
  const left = a < 0 ? primitive(a, gamma) - primitive(Math.min(b, 0), gamma) : 0;
  const right = b > 0 ? primitive(b, gamma) - primitive(Math.max(a, 0), gamma) : 0;
  return length * (left + right);
}
export function numericalSlice(gamma: number, low: number, high: number, length = 1, steps = 4096): number {
  if (low >= high) return 0;
  const dt = (high - low) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const theta = low + (i + .5) * dt;
    sum += Math.max(0, Math.cos(theta - gamma)) * Math.abs(Math.sin(theta));
  }
  return length * sum * dt;
}
export function hemisphereAverage(normal: [number, number, number], slices = 2048): number {
  let sum = 0;
  for (let i = 0; i < slices; i++) {
    const phi = (i + .5) / slices * PI;
    const x = normal[0] * Math.cos(phi) + normal[1] * Math.sin(phi), z = normal[2];
    sum += sliceIntegral(Math.atan2(x, z), -PI, PI, Math.hypot(x, z));
  }
  return sum / slices;
}
