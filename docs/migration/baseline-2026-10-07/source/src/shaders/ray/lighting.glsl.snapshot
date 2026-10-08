// Shared deterministic local-radiance model for the R4 ray/SSR/mirror-camera
// comparison. This is deliberately separate from the physical path integrator.
// Inputs and output are linear RGB. The emission argument is directional Le;
// rtLocalShade below evaluates the geometric front-face condition before use.
// Append after query.glsl.
uniform int uLocalModel; // 0 shared local lighting, 1 emissive material-color test.
vec3 rtLocalRadiance(vec3 albedo, vec3 emission, vec3 shadingNormal) {
  if (uLocalModel == 1) return albedo + emission;
  vec3 lightDirection = normalize(vec3(-0.55, 0.85, 0.65));
  return emission + albedo * (0.18 + 0.82 * max(dot(shadingNormal, lightDirection), 0.0));
}

vec3 rtLocalShade(Hit hit, vec3 incomingDirection) {
  vec3 albedo = texelFetch(tMaterials, ivec2(0, hit.materialId), 0).rgb;
  bool frontFace = dot(incomingDirection, hit.geometricNormal) < 0.0;
  vec3 emission = frontFace ? texelFetch(tMaterials, ivec2(1, hit.materialId), 0).rgb : vec3(0.0);
  vec3 normal = frontFace ? hit.geometricNormal : -hit.geometricNormal;
  return rtLocalRadiance(albedo, emission, normal);
}
