// Shared by the material lab and RT06. Isotropic GGX, alpha = roughness^2.
// This is the site's explicit parameterization, not an exact PBRT/UE port.
// @snippet ggx-start
float pbrGgxD(float noH, float alpha) {
  float a2 = alpha * alpha;
  float noH2 = noH * noH;
  // Algebraically identical to noH2*(a2-1)+1, without subtracting nearly
  // equal values at the very narrow peak when roughness is near 0.03.
  float denominator = (1.0 - noH2) + a2 * noH2;
  return a2 / (3.14159265358979323846 * denominator * denominator);
}
float pbrSmithG1(float cosine, float alpha) {
  float a2 = alpha * alpha;
  return 2.0 * cosine / (cosine + sqrt(a2 + (1.0 - a2) * cosine * cosine));
}
vec3 pbrSchlick(vec3 f0, float cosine) {
  return f0 + (vec3(1.0) - f0) * pow(1.0 - cosine, 5.0);
}
// @snippet ggx-end
