precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D tPosition;
uniform sampler2D tNormal;
uniform sampler2D tAlbedo;
uniform sampler2D tShadowDepth;
uniform mat4 uLightView;
uniform mat4 uLightProjection;
uniform mat4 uLightWorld;
uniform mat4 uLightInvProjection;
uniform vec2 uNearFar;
uniform float uTanHalfFov;
uniform float uSearchNear;
uniform float uBias;
uniform float uFilterRadius;
uniform float uLightSize;
uniform int uPlaneCorrection;
uniform int uAlgorithm; // 0 hard, 1 fixed 9x9 PCF, 2 81-search + 9x9 PCSS.
uniform int uView; // 0 lit, 1 visibility, 2 actual raster shadow map.
uniform int uDebug;
uniform vec2 uInspectUv;

struct Surface { vec3 position; vec3 normal; vec3 albedo; float objectId; bool valid; };
struct Tap {
  vec2 uv;
  float depth;
  float receiver;
  float distance;
  bool visible;
  bool valid;
  bool blocker;
  int stage; // 0 blocker search, 1 visibility filtering.
};
struct ShadowResult {
  vec2 lightUv;
  float receiverDepth;
  float receiverDistance;
  float storedDepth;
  float storedDistance;
  float visibility;
  float blockerDistance;
  float radiusTexels;
  float searchRadiusTexels;
  int blockers;
  int searches;
  int filters;
  bool covered;
  bool centerValid;
  Tap selected;
};

bool finiteFloat(float x) { return !isnan(x) && !isinf(x); }
bool onMap(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))); }
float linearDepth(float depth) {
  return uNearFar.x * uNearFar.y / (uNearFar.y - depth * (uNearFar.y - uNearFar.x));
}
float projectedDepth(float distance) {
  return uNearFar.y * (distance - uNearFar.x) / (distance * (uNearFar.y - uNearFar.x));
}
Tap emptyTap(int stage) {
  Tap tap;
  tap.uv = vec2(-1.0); tap.depth = -1.0; tap.receiver = -1.0; tap.distance = 0.0;
  tap.visible = false; tap.valid = false; tap.blocker = false; tap.stage = stage;
  return tap;
}
Surface surfaceAt(vec2 uv) {
  Surface surface;
  vec4 position = texture(tPosition, uv);
  surface.position = position.xyz;
  surface.normal = texture(tNormal, uv).xyz;
  surface.albedo = texture(tAlbedo, uv).rgb;
  surface.objectId = position.w - 1.0;
  surface.valid = position.w > 0.0;
  return surface;
}
Tap shadowTap(vec2 requestedUv, Surface surface, int stage) {
  Tap tap = emptyTap(stage);
  tap.uv = requestedUv;
  if (!onMap(requestedUv)) return tap;
  ivec2 size = textureSize(tShadowDepth, 0);
  ivec2 pixel = clamp(ivec2(floor(requestedUv * vec2(size))), ivec2(0), size - 1);
  tap.uv = (vec2(pixel) + 0.5) / vec2(size);
  // @snippet compare-start
  tap.depth = texelFetch(tShadowDepth, pixel, 0).r;
  tap.distance = linearDepth(tap.depth);
  float receiver = -(uLightView * vec4(surface.position, 1.0)).z;
  if (uPlaneCorrection != 0) {
    vec4 local = uLightInvProjection * vec4(tap.uv * 2.0 - 1.0, 0.0, 1.0);
    vec3 direction = normalize(mat3(uLightWorld) * (local.xyz / local.w));
    vec3 origin = uLightWorld[3].xyz;
    float denominator = dot(surface.normal, direction);
    if (abs(denominator) < 1e-7) return tap;
    float distance = dot(surface.normal, surface.position - origin) / denominator;
    if (distance <= 0.0 || !finiteFloat(distance)) return tap;
    receiver = -(uLightView * vec4(origin + direction * distance, 1.0)).z;
  }
  // Bias is specified in axial world units, then reprojected to the SAME
  // nonlinear measure as the sampled hardware depth before comparison.
  tap.receiver = projectedDepth(receiver - uBias);
  tap.valid = receiver >= uNearFar.x && receiver <= uNearFar.y &&
    finiteFloat(tap.receiver) && finiteFloat(tap.depth);
  tap.visible = tap.valid && tap.receiver <= tap.depth;
  tap.blocker = tap.valid && !tap.visible;
  // @snippet compare-end
  return tap;
}
// @snippet pcss-start
void pcssRadius(inout ShadowResult result, float blockerSum, float resolution) {
  result.blockerDistance = blockerSum / float(result.blockers);
  float worldRadius = uLightSize * max(0.0, result.receiverDistance - result.blockerDistance) / result.blockerDistance;
  float uvRadius = worldRadius / (2.0 * uTanHalfFov * result.receiverDistance);
  result.radiusTexels = uvRadius * resolution;
}
// @snippet pcss-end
void recordTap(inout ShadowResult result, Tap tap, int selectedTap) {
  int index = result.searches + result.filters;
  if (index == selectedTap) result.selected = tap;
  if (tap.stage == 0) ++result.searches; else ++result.filters;
  if (!tap.valid) result.covered = false;
}
ShadowResult queryShadow(Surface surface, int selectedTap) {
  ShadowResult result;
  result.lightUv = vec2(-1.0); result.receiverDepth = -1.0; result.receiverDistance = 0.0;
  result.storedDepth = -1.0; result.storedDistance = 0.0; result.visibility = 0.0;
  result.blockerDistance = 0.0; result.radiusTexels = 0.0; result.searchRadiusTexels = 0.0;
  result.blockers = 0; result.searches = 0; result.filters = 0;
  result.covered = false; result.centerValid = false; result.selected = emptyTap(1);
  if (!surface.valid) return result;
  vec4 view = uLightView * vec4(surface.position, 1.0);
  vec4 clip = uLightProjection * view;
  result.receiverDistance = -view.z;
  if (clip.w <= 0.0) return result;
  result.lightUv = clip.xy / clip.w * 0.5 + 0.5;
  result.receiverDepth = clip.z / clip.w * 0.5 + 0.5;
  if (!onMap(result.lightUv) || result.receiverDepth < 0.0 || result.receiverDepth > 1.0) return result;
  Tap center = shadowTap(result.lightUv, surface, 1);
  result.storedDepth = center.depth; result.storedDistance = center.distance;
  result.centerValid = center.valid; result.covered = center.valid;
  if (uAlgorithm == 0 || (uAlgorithm == 2 && uLightSize <= 0.0)) {
    recordTap(result, center, selectedTap);
    result.visibility = center.visible ? 1.0 : 0.0;
    return result;
  }
  float resolution = float(textureSize(tShadowDepth, 0).x);
  float radius = uFilterRadius / resolution;
  if (uAlgorithm == 2) {
    // The closest scene vertex provides a conservative blocker depth bound.
    // Clamping it to the projection near plane also covers triangles that
    // cross that plane; it is never inferred from a sparse sample of the map.
    float bound = max(uNearFar.x, uSearchNear);
    float searchRadius = uLightSize * max(0.0, result.receiverDistance - bound) /
      (2.0 * uTanHalfFov * bound * result.receiverDistance);
    result.searchRadiusTexels = searchRadius * resolution;
    float blockerSum = 0.0;
    for (int y = -4; y <= 4; ++y) for (int x = -4; x <= 4; ++x) {
      Tap tap = shadowTap(result.lightUv + vec2(float(x), float(y)) * searchRadius / 4.0, surface, 0);
      recordTap(result, tap, selectedTap);
      if (tap.blocker) { blockerSum += tap.distance; ++result.blockers; }
    }
    if (result.blockers == 0) {
      result.visibility = 1.0;
      return result;
    }
    pcssRadius(result, blockerSum, resolution);
    radius = result.radiusTexels / resolution;
  }
  result.radiusTexels = radius * resolution;
  float visible = 0.0;
  for (int y = -4; y <= 4; ++y) for (int x = -4; x <= 4; ++x) {
    Tap tap = shadowTap(result.lightUv + vec2(float(x), float(y)) * radius / 4.0, surface, 1);
    recordTap(result, tap, selectedTap);
    visible += tap.visible ? 1.0 : 0.0;
  }
  // Missing taps remain explicit via covered=false; callers must not present
  // this partial average as a visibility measurement.
  result.visibility = visible / 81.0;
  return result;
}
vec4 debugPixel(Surface surface, ShadowResult result, int pixel) {
  if (pixel == 0) return vec4(surface.position, surface.objectId);
  if (pixel == 1) return vec4(surface.normal, result.covered ? 1.0 : 0.0);
  if (pixel == 2) return vec4(result.lightUv, result.receiverDepth, result.storedDepth);
  if (pixel == 3) return vec4(result.receiverDistance, result.storedDistance, result.visibility, float(result.blockers));
  if (pixel == 4) return vec4(result.blockerDistance, result.radiusTexels, float(result.searches), float(result.filters));
  if (pixel == 5) return vec4(result.searchRadiusTexels, float(uAlgorithm), surface.valid ? 1.0 : 0.0, result.centerValid ? 1.0 : 0.0);
  if (pixel == 6) return vec4(uBias, float(uPlaneCorrection), uNearFar);
  if (pixel == 7) return vec4(0.0);
  Tap tap = result.selected;
  if ((pixel - 8) % 2 == 0) return vec4(tap.uv, tap.depth, tap.receiver);
  return vec4(tap.visible ? 1.0 : 0.0, tap.valid ? 1.0 : 0.0, tap.blocker ? 1.0 : 0.0, float(tap.stage));
}
void main() {
  if (uDebug == 0 && uView == 2) {
    float distance = linearDepth(texture(tShadowDepth, vUv).r);
    outColor = vec4(vec3(clamp(distance / uNearFar.y, 0.0, 1.0)), 1.0);
    return;
  }
  int pixel = int(floor(gl_FragCoord.x));
  Surface surface = surfaceAt(uDebug != 0 ? uInspectUv : vUv);
  ShadowResult result = queryShadow(surface, uDebug != 0 ? (pixel - 8) / 2 : -1);
  if (uDebug != 0) { outColor = debugPixel(surface, result, pixel); return; }
  if (!surface.valid) { outColor = vec4(mix(vec3(0.50, 0.61, 0.70), vec3(0.79, 0.84, 0.88), vUv.y), 1.0); return; }
  if (!result.covered) { outColor = vec4(0.95, 0.22, 0.025, 1.0); return; }
  if (uView == 1) { outColor = vec4(vec3(result.visibility), 1.0); return; }
  vec3 albedo = surface.albedo;
  if (surface.objectId < 0.5) {
    vec2 grid = abs(fract(surface.position.xz + 0.5) - 0.5) / max(fwidth(surface.position.xz), vec2(0.0001));
    float line = 1.0 - min(1.0, min(grid.x, grid.y));
    albedo *= 1.0 - 0.14 * line;
  }
  vec3 toLight = normalize(uLightWorld[3].xyz - surface.position);
  float diffuse = max(dot(surface.normal, toLight), 0.0);
  outColor = vec4(albedo * (0.22 + 0.78 * diffuse * result.visibility), 1.0);
}
