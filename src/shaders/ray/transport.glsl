// GLSL3 fragment entry point: concatenate query.glsl + lighting.glsl + this.
// One deterministic sample per invocation, linear RGB, alpha=valid diagnostic.
in vec2 vUv;
out vec4 outColor;

uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec2 uResolution;
uniform vec2 uInspectUv;
uniform float uRayMin;
uniform float uRayMax;
uniform float uOffsetScale;
uniform float uSceneScale;
uniform int uDebug;
uniform int uMode; // 0 path, 1 visibility, 2 R4 reflection, 3 indirect B, 4 direct+Le.
uniform vec3 uLightCenter;
uniform vec3 uLightU; // Half-extent vectors; area = 4 * length(cross(U,V)).
uniform vec3 uLightV;
uniform vec3 uLightNormal;
uniform vec3 uLightEmission;
uniform vec3 uEnvironment;
uniform int uSampleIndex;
uniform int uSeed;
uniform int uMaxScattering;
uniform int uEstimator; // 0 BSDF only, 1 NEE, 2 power-heuristic MIS.
uniform int uSampling;  // Lambert: 0 uniform hemisphere, 1 cosine hemisphere.
uniform int uRR;
uniform float uRoughness; // >0 overrides GGX material roughness; <=0 uses material.

const float PT_PI = 3.14159265358979323846;
const int PT_MAX_SCATTERING = 8;
const int PT_LOG_EVENTS = 8;
const int PT_CONTINUE = 0;
const int PT_MISS = 1;
const int PT_EMITTER = 2;
const int PT_DEPTH = 3;
const int PT_RR = 4;
const int PT_INVALID = 5;
const int PT_OVERFLOW = 6;
const int PT_ZERO = 7;
const int PT_COMPLETE = 8;

struct PTMaterial { vec3 albedo; vec3 emission; int kind; float roughness; };
struct PTEvent {
  vec4 originEvent;
  vec4 directionPdf;
  vec4 positionPrimitive;
  vec4 normalObject;
  vec4 betaMaterial;
  vec4 pdfsTerminal;
  vec4 hitCosts;
  vec4 contributionValid;
};
struct PTResult {
  vec3 radiance;
  int status; // 0 valid, 2 query overflow, 3 invalid (distinct from termination).
  int termination;
  int scattering;
  int pathEvents;
  int primaryRays;
  int continuationRays;
  int shadowRays;
  int nodes;
  int tests;
  PTEvent selected;
};

// CPU-reproducible uint32 counter RNG. Every multiply wraps modulo 2^32.
// Dimensions: 0/1 area light, 2/3 BSDF, 4 roulette. No sequential RNG state.
uint ptHash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  return x ^ (x >> 16u);
}
float ptRandom(ivec2 pixel, int bounce, int dimension) {
  uint h = ptHash(uint(uSeed) ^ 0xa511e9b3u);
  h = ptHash(h ^ uint(pixel.x));
  h = ptHash(h ^ (uint(pixel.y) * 0x9e3779b9u));
  h = ptHash(h ^ (uint(uSampleIndex) * 0x85ebca6bu));
  h = ptHash(h ^ (uint(bounce) * 0xc2b2ae35u));
  h = ptHash(h ^ (uint(dimension) * 0x27d4eb2fu));
  return float(h >> 8u) * (1.0 / 16777216.0);
}

PTEvent ptEmptyEvent() {
  PTEvent e;
  e.originEvent = vec4(0.0, 0.0, 0.0, -1.0);
  e.directionPdf = vec4(0.0);
  e.positionPrimitive = vec4(0.0, 0.0, 0.0, -1.0);
  e.normalObject = vec4(0.0, 0.0, 0.0, -1.0);
  e.betaMaterial = vec4(0.0, 0.0, 0.0, -1.0);
  e.pdfsTerminal = vec4(0.0);
  e.hitCosts = vec4(-1.0, 0.0, 0.0, 0.0);
  e.contributionValid = vec4(0.0);
  return e;
}
PTResult ptEmptyResult() {
  PTResult r;
  r.radiance = vec3(0.0); r.status = 0; r.termination = PT_CONTINUE;
  r.scattering = 0; r.pathEvents = 0;
  r.primaryRays = 0; r.continuationRays = 0; r.shadowRays = 0;
  r.nodes = 0; r.tests = 0; r.selected = ptEmptyEvent();
  return r;
}
PTEvent ptEvent(Ray ray, QueryResult query, vec3 beta, float arrivingPdf) {
  PTEvent e = ptEmptyEvent();
  e.originEvent = vec4(ray.origin, float(query.status));
  e.directionPdf = vec4(ray.direction, arrivingPdf);
  e.positionPrimitive = vec4(query.hit.position, float(query.hit.primitiveId));
  e.normalObject = vec4(query.hit.geometricNormal, float(query.hit.objectId));
  e.betaMaterial = vec4(beta, float(query.hit.materialId));
  e.hitCosts = vec4(query.hit.t, float(query.nodeVisits), float(query.primitiveTests), query.hit.frontFace ? 1.0 : 0.0);
  e.contributionValid.w = query.status == RT_INVALID || query.status == RT_OVERFLOW ? 0.0 : 1.0;
  return e;
}
void ptRecord(inout PTResult result, PTEvent event, int selectedEvent) {
  if (result.pathEvents == selectedEvent && selectedEvent < PT_LOG_EVENTS) result.selected = event;
  ++result.pathEvents;
}
void ptCosts(inout PTResult result, QueryResult query) {
  result.nodes += query.nodeVisits; result.tests += query.primitiveTests;
}
bool ptQueryFailure(inout PTResult result, QueryResult query) {
  if (query.status == RT_INVALID || query.status == RT_OVERFLOW) {
    result.status = query.status;
    result.termination = query.status == RT_OVERFLOW ? PT_OVERFLOW : PT_INVALID;
    return true;
  }
  return false;
}
void ptAdd(inout PTResult result, inout PTEvent event, vec3 value) {
  result.radiance += value;
  event.contributionValid.rgb += value;
}

Ray ptCameraRay(vec2 uv) {
  vec4 point = uInvProjection * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  Ray ray;
  ray.origin = (uCameraWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  ray.direction = normalize(mat3(uCameraWorld) * (point.xyz / point.w));
  ray.tMin = uRayMin; ray.tMax = uRayMax;
  return ray;
}
float ptOffsetDistance(vec3 p) {
  return 2e-5 * max(max(abs(uSceneScale), 1e-3), max(abs(p.x), max(abs(p.y), abs(p.z))));
}
vec3 ptOrigin(Hit hit, vec3 direction) {
  float side = dot(direction, hit.geometricNormal) >= 0.0 ? 1.0 : -1.0;
  return hit.position + side * ptOffsetDistance(hit.position) * uOffsetScale * hit.geometricNormal;
}
Ray ptSpawn(Hit hit, vec3 direction) {
  Ray ray;
  ray.origin = ptOrigin(hit, direction); ray.direction = normalize(direction);
  ray.tMin = uRayMin; ray.tMax = uRayMax;
  return ray;
}
bool ptMaterial(Hit hit, out PTMaterial material) {
  vec4 a = texelFetch(tMaterials, ivec2(0, hit.materialId), 0);
  vec4 b = texelFetch(tMaterials, ivec2(1, hit.materialId), 0);
  material.albedo = a.rgb; material.emission = b.rgb;
  material.kind = int(a.w);
  material.roughness = uRoughness > 0.0 ? uRoughness : b.w;
  return rtFinite3(a.rgb) && rtFinite3(b.rgb) &&
    all(greaterThanEqual(a.rgb, vec3(0.0))) && all(lessThanEqual(a.rgb, vec3(1.0))) &&
    all(greaterThanEqual(b.rgb, vec3(0.0))) && rtInteger(a.w) && a.w >= 0.0 && a.w <= 2.0 &&
    rtFinite(material.roughness);
}
float ptPower(float a, float b) {
  // Ratio form avoids overflow when solid-angle PDFs become large.
  if (a <= 0.0) return 0.0;
  if (b <= 0.0) return 1.0;
  float ratio = b / a;
  return 1.0 / (1.0 + ratio * ratio);
}
vec3 ptFrame(vec3 localDirection, vec3 normal) {
  vec3 tangent = normalize(cross(abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0), normal));
  return normalize(tangent * localDirection.x + cross(normal, tangent) * localDirection.y + normal * localDirection.z);
}
float ptGgxD(float nDotH, float alpha) {
  return pbrGgxD(nDotH, alpha);
}
float ptGgxG1(float nDotDirection, float alpha) {
  return pbrSmithG1(nDotDirection, alpha);
}
vec3 ptBsdf(PTMaterial material, vec3 normal, vec3 wo, vec3 wi, out float pdf) {
  pdf = 0.0;
  float noL = dot(normal, wi), noV = dot(normal, wo);
  if (noL <= 0.0 || noV <= 0.0 || material.kind == 1) return vec3(0.0);
  if (material.kind == 0) {
    pdf = uSampling == 0 ? 1.0 / (2.0 * PT_PI) : noL / PT_PI;
    return material.albedo / PT_PI;
  }
  vec3 sum = wi + wo;
  if (dot(sum, sum) <= 1e-20) return vec3(0.0);
  vec3 halfVector = normalize(sum);
  float noH = max(dot(normal, halfVector), 0.0), voH = max(dot(wo, halfVector), 0.0);
  if (noH <= 0.0 || voH <= 0.0) return vec3(0.0);
  float roughness = clamp(material.roughness, 0.03, 1.0);
  float alpha = roughness * roughness;
  float d = ptGgxD(noH, alpha);
  float g = ptGgxG1(noL, alpha) * ptGgxG1(noV, alpha);
  vec3 fresnel = pbrSchlick(material.albedo, voH);
  pdf = d * noH / (4.0 * voH);
  return fresnel * d * g / (4.0 * noL * noV);
}
bool ptSampleBsdf(PTMaterial material, vec3 normal, vec3 wo, vec2 random, out vec3 wi, out vec3 weight, out float pdf, out bool delta) {
  wi = vec3(0.0); weight = vec3(0.0); pdf = 0.0; delta = material.kind == 1;
  if (delta) {
    wi = normalize(reflect(-wo, normal)); weight = material.albedo;
    return dot(wi, normal) > 0.0;
  }
  float phi = 2.0 * PT_PI * random.y;
  if (material.kind == 0) {
    float z = uSampling == 0 ? random.x : sqrt(max(0.0, 1.0 - random.x));
    float radius = sqrt(max(0.0, 1.0 - z * z));
    wi = ptFrame(vec3(radius * cos(phi), radius * sin(phi), z), normal);
  } else {
    float roughness = clamp(material.roughness, 0.03, 1.0);
    float alpha = roughness * roughness;
    float cosTheta = sqrt((1.0 - random.x) / (1.0 + (alpha * alpha - 1.0) * random.x));
    float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
    vec3 halfVector = ptFrame(vec3(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta), normal);
    if (dot(wo, halfVector) <= 0.0) return false;
    wi = normalize(reflect(-wo, halfVector));
  }
  vec3 f = ptBsdf(material, normal, wo, wi, pdf);
  if (pdf <= 0.0) return false;
  weight = f * max(dot(normal, wi), 0.0) / pdf;
  return rtFinite3(weight) && rtFinite(pdf) && any(greaterThan(weight, vec3(0.0)));
}

float ptLightArea() { return 4.0 * length(cross(uLightU, uLightV)); }
bool ptNeeAvailable() {
  return rtFinite3(uLightCenter) && rtFinite3(uLightU) && rtFinite3(uLightV) && rtFinite3(uLightNormal) &&
    dot(uLightNormal, uLightNormal) > 0.0 && ptLightArea() > 0.0 &&
    any(greaterThan(uLightEmission, vec3(0.0)));
}
float ptLightPdf(vec3 from, vec3 point) {
  vec3 displacement = point - from;
  float distanceSquared = dot(displacement, displacement);
  if (distanceSquared <= 1e-20 || dot(uLightNormal, uLightNormal) <= 0.0) return 0.0;
  float cosine = dot(normalize(uLightNormal), -normalize(displacement));
  float area = ptLightArea();
  return cosine > 0.0 && area > 0.0 ? distanceSquared / (area * cosine) : 0.0;
}
bool ptCoveredEmitter(Hit hit) {
  // Only this sampled rectangle is covered by the competing light strategy.
  // Other emissive primitives must retain their BSDF-hit contribution.
  vec3 relative = hit.position - uLightCenter;
  float uu = dot(uLightU, uLightU), uv = dot(uLightU, uLightV), vv = dot(uLightV, uLightV);
  float determinant = uu * vv - uv * uv;
  if (determinant <= 0.0 || dot(hit.geometricNormal, normalize(uLightNormal)) < 0.99) return false;
  float pu = dot(relative, uLightU), pv = dot(relative, uLightV);
  float a = (pu * vv - pv * uv) / determinant, b = (pv * uu - pu * uv) / determinant;
  float tolerance = max(1e-5, ptOffsetDistance(hit.position) * 2.0);
  return abs(dot(relative, normalize(uLightNormal))) <= tolerance && abs(a) <= 1.00001 && abs(b) <= 1.00001;
}
vec3 ptLightPoint(ivec2 pixel, int bounce) {
  return uLightCenter + (2.0 * ptRandom(pixel, bounce, 0) - 1.0) * uLightU +
    (2.0 * ptRandom(pixel, bounce, 1) - 1.0) * uLightV;
}
bool ptShadowRay(Hit hit, vec3 point, out Ray shadow) {
  vec3 direction = point - hit.position;
  if (dot(direction, direction) <= 1e-20) return false;
  shadow.origin = ptOrigin(hit, normalize(direction));
  vec3 toLight = point - shadow.origin;
  float distance = length(toLight);
  // Exclude the sampled light endpoint. The full segment, not uRayMax, defines
  // this visibility question; continuation rays retain the global tMax.
  float endpointOffset = ptOffsetDistance(point) * max(1.0, abs(uOffsetScale));
  shadow.direction = toLight / distance;
  shadow.tMin = uRayMin; shadow.tMax = distance - endpointOffset;
  return shadow.tMax >= shadow.tMin && rtValidRay(shadow);
}

PTResult ptPath(Ray ray, ivec2 pixel, int selectedEvent) {
  PTResult result = ptEmptyResult();
  vec3 beta = vec3(1.0);
  float arrivingPdf = 0.0;
  bool previousDelta = true;
  vec3 previousPosition = ray.origin;
  // Eight scatterings require up to NINE queries: the last endpoint is still
  // emission/miss tested before the finite scattering budget is checked.
  for (int eventIndex = 0; eventIndex <= PT_MAX_SCATTERING; ++eventIndex) {
    QueryResult query = rtQueryMode(ray, -1, 0);
    if (eventIndex == 0) ++result.primaryRays; else ++result.continuationRays;
    ptCosts(result, query);
    PTEvent event = ptEvent(ray, query, beta, arrivingPdf);
    if (ptQueryFailure(result, query)) {
      event.pdfsTerminal.w = float(result.termination); ptRecord(result, event, selectedEvent); break;
    }
    if (query.status == RT_MISS) {
      // Environment-only sampling is an explicitly BSDF-only preset. NEE/MIS
      // operate with black environment, so their competing strategies agree.
      if (uEstimator == 0 && (uMode != 3 || result.scattering >= 2)) ptAdd(result, event, beta * uEnvironment);
      result.termination = PT_MISS; event.pdfsTerminal.w = float(PT_MISS);
      ptRecord(result, event, selectedEvent); break;
    }
    Hit hit = query.hit;
    PTMaterial material;
    if (!ptMaterial(hit, material)) {
      result.status = RT_INVALID; result.termination = PT_INVALID;
      event.pdfsTerminal.w = float(PT_INVALID); event.contributionValid.w = 0.0;
      ptRecord(result, event, selectedEvent); break;
    }
    if (any(greaterThan(material.emission, vec3(0.0)))) {
      float weight = 1.0;
      bool covered = result.scattering > 0 && !previousDelta && ptNeeAvailable() && ptCoveredEmitter(hit);
      float lightPdf = covered ? ptLightPdf(previousPosition, hit.position) : 0.0;
      if (covered && uEstimator == 1) weight = 0.0;
      if (covered && uEstimator == 2) weight = ptPower(arrivingPdf, lightPdf);
      event.pdfsTerminal = vec4(lightPdf, arrivingPdf, weight, float(PT_EMITTER));
      if (hit.frontFace && (uMode != 3 || result.scattering >= 2)) ptAdd(result, event, beta * material.emission * weight);
      result.termination = PT_EMITTER; ptRecord(result, event, selectedEvent); break;
    }
    if (result.scattering >= uMaxScattering) {
      result.termination = PT_DEPTH; event.pdfsTerminal.w = float(PT_DEPTH);
      ptRecord(result, event, selectedEvent); break;
    }
    if (uMode == 3 && result.scattering == 0) {
      if (material.kind != 0) {
        result.termination = PT_COMPLETE; event.pdfsTerminal.w = float(PT_COMPLETE);
        ptRecord(result, event, selectedEvent); break;
      }
      // B is transported directly. No division by the receiver's rho, so dark
      // and zero-albedo receivers remain well-defined and share the same B.
      material.albedo = vec3(1.0);
    }
    vec3 normal = hit.shadingNormal, wo = -ray.direction;
    bool indirectEligible = uMode != 3 || result.scattering >= 1;
    if (uEstimator != 0 && material.kind != 1 && indirectEligible && ptNeeAvailable()) {
      vec3 point = ptLightPoint(pixel, result.scattering);
      vec3 wi = normalize(point - hit.position);
      float lightPdf = ptLightPdf(hit.position, point), bsdfPdf;
      vec3 f = ptBsdf(material, normal, wo, wi, bsdfPdf);
      event.pdfsTerminal.x = lightPdf;
      if (lightPdf > 0.0 && rtFinite(lightPdf) && any(greaterThan(f, vec3(0.0)))) {
        Ray shadow;
        if (ptShadowRay(hit, point, shadow)) {
          QueryResult visibility = rtQueryMode(shadow, -1, 1);
          ++result.shadowRays; ptCosts(result, visibility);
          if (ptQueryFailure(result, visibility)) {
            event.pdfsTerminal.w = float(result.termination); event.contributionValid.w = 0.0;
            ptRecord(result, event, selectedEvent); break;
          }
          float weight = uEstimator == 2 ? ptPower(lightPdf, bsdfPdf) : 1.0;
          event.pdfsTerminal.z = weight;
          if (visibility.status == RT_MISS) ptAdd(result, event, beta * f * uLightEmission * max(dot(normal, wi), 0.0) * weight / lightPdf);
        }
      }
    }
    vec3 wi, bsdfWeight;
    float bsdfPdf;
    bool delta;
    bool sampled = ptSampleBsdf(material, normal, wo,
      vec2(ptRandom(pixel, result.scattering, 2), ptRandom(pixel, result.scattering, 3)), wi, bsdfWeight, bsdfPdf, delta);
    event.pdfsTerminal.y = bsdfPdf;
    ++result.scattering;
    if (!sampled) {
      result.termination = PT_ZERO; event.pdfsTerminal.w = float(PT_ZERO);
      ptRecord(result, event, selectedEvent); break;
    }
    beta *= bsdfWeight;
    if (!rtFinite3(beta) || any(lessThan(beta, vec3(0.0)))) {
      result.status = RT_INVALID; result.termination = PT_INVALID;
      event.pdfsTerminal.w = float(PT_INVALID); event.contributionValid.w = 0.0;
      ptRecord(result, event, selectedEvent); break;
    }
    // Apply roulette after the third processed scattering, only when another
    // scattering is still permitted. Surviving throughput includes 1/p.
    if (uRR != 0 && result.scattering >= 3 && result.scattering < uMaxScattering) {
      float survival = clamp(max(beta.r, max(beta.g, beta.b)), 0.05, 0.95);
      if (ptRandom(pixel, result.scattering - 1, 4) >= survival) {
        result.termination = PT_RR; event.pdfsTerminal.w = float(PT_RR);
        ptRecord(result, event, selectedEvent); break;
      }
      beta /= survival;
    }
    previousPosition = hit.position; previousDelta = delta; arrivingPdf = bsdfPdf;
    ray = ptSpawn(hit, wi);
    ptRecord(result, event, selectedEvent);
  }
  return result;
}

PTResult ptVisibility(Ray ray, ivec2 pixel, int selectedEvent) {
  PTResult result = ptEmptyResult();
  QueryResult primary = rtQueryMode(ray, -1, 0);
  ++result.primaryRays; ptCosts(result, primary);
  PTEvent event = ptEvent(ray, primary, vec3(1.0), 0.0);
  if (ptQueryFailure(result, primary) || primary.status == RT_MISS) {
    if (primary.status == RT_MISS) result.termination = PT_MISS;
    event.pdfsTerminal.w = float(result.termination); ptRecord(result, event, selectedEvent); return result;
  }
  Ray shadow;
  vec3 point = ptLightPoint(pixel, 0);
  event.pdfsTerminal.x = ptLightPdf(primary.hit.position, point);
  if (!ptShadowRay(primary.hit, point, shadow)) {
    result.termination = PT_ZERO; event.pdfsTerminal.w = float(PT_ZERO); ptRecord(result, event, selectedEvent); return result;
  }
  ptRecord(result, event, selectedEvent);
  QueryResult visibility = rtQueryMode(shadow, -1, 1);
  ++result.shadowRays; ptCosts(result, visibility);
  event = ptEvent(shadow, visibility, vec3(1.0), 0.0);
  if (!ptQueryFailure(result, visibility)) {
    ptAdd(result, event, vec3(visibility.status == RT_MISS ? 1.0 : 0.0));
    result.termination = PT_COMPLETE;
  }
  event.pdfsTerminal.w = float(result.termination); ptRecord(result, event, selectedEvent);
  return result;
}

PTResult ptReflection(Ray ray, int selectedEvent) {
  PTResult result = ptEmptyResult();
  QueryResult primary = rtQueryMode(ray, -1, 0);
  ++result.primaryRays; ptCosts(result, primary);
  PTEvent event = ptEvent(ray, primary, vec3(1.0), 0.0);
  if (ptQueryFailure(result, primary) || primary.status == RT_MISS) {
    if (primary.status == RT_MISS) { result.termination = PT_MISS; ptAdd(result, event, uEnvironment); }
    event.pdfsTerminal.w = float(result.termination); ptRecord(result, event, selectedEvent); return result;
  }
  PTMaterial material;
  if (!ptMaterial(primary.hit, material)) {
    result.status = RT_INVALID; result.termination = PT_INVALID;
    event.pdfsTerminal.w = float(PT_INVALID); event.contributionValid.w = 0.0; ptRecord(result, event, selectedEvent); return result;
  }
  if (material.kind != 1) {
    ptAdd(result, event, rtLocalShade(primary.hit, ray.direction)); result.termination = PT_COMPLETE;
    event.pdfsTerminal.w = float(PT_COMPLETE); ptRecord(result, event, selectedEvent); return result;
  }
  result.scattering = 1;
  Ray reflected = ptSpawn(primary.hit, reflect(ray.direction, primary.hit.shadingNormal));
  ptRecord(result, event, selectedEvent);
  QueryResult secondary = rtQueryMode(reflected, -1, 0);
  ++result.continuationRays; ptCosts(result, secondary);
  event = ptEvent(reflected, secondary, material.albedo, 0.0);
  if (!ptQueryFailure(result, secondary)) {
    vec3 incoming = secondary.status == RT_HIT ? rtLocalShade(secondary.hit, reflected.direction) : uEnvironment;
    ptAdd(result, event, material.albedo * incoming);
    result.termination = secondary.status == RT_MISS ? PT_MISS : PT_COMPLETE;
  }
  event.pdfsTerminal.w = float(result.termination); ptRecord(result, event, selectedEvent);
  return result;
}

PTResult ptDirect(Ray ray, ivec2 pixel, int selectedEvent) {
  PTResult result = ptEmptyResult();
  QueryResult primary = rtQueryMode(ray, -1, 0);
  ++result.primaryRays; ptCosts(result, primary);
  PTEvent event = ptEvent(ray, primary, vec3(1.0), 0.0);
  if (ptQueryFailure(result, primary) || primary.status == RT_MISS) {
    if (primary.status == RT_MISS) result.termination = PT_MISS;
    event.pdfsTerminal.w = float(result.termination); ptRecord(result, event, selectedEvent); return result;
  }
  PTMaterial material;
  if (!ptMaterial(primary.hit, material)) {
    result.status = RT_INVALID; result.termination = PT_INVALID;
    event.pdfsTerminal.w = float(PT_INVALID); event.contributionValid.w = 0.0;
    ptRecord(result, event, selectedEvent); return result;
  }
  if (any(greaterThan(material.emission, vec3(0.0)))) {
    if (primary.hit.frontFace) ptAdd(result, event, material.emission);
    result.termination = PT_EMITTER; event.pdfsTerminal.w = float(PT_EMITTER);
    ptRecord(result, event, selectedEvent); return result;
  }
  result.scattering = 1;
  if (material.kind != 1 && ptNeeAvailable()) {
    for (int sampleNumber = 0; sampleNumber < 16; ++sampleNumber) {
      // Fixed 4x4 stratification with counter-random positions inside each cell.
      // Dimensions 8..39 are reserved for this physical direct-light layer.
      vec2 cell = vec2(float(sampleNumber % 4), float(sampleNumber / 4));
      vec2 random = vec2(ptRandom(pixel, 0, 8 + 2 * sampleNumber), ptRandom(pixel, 0, 9 + 2 * sampleNumber));
      vec2 sampleUv = (cell + random) * 0.25;
      vec3 point = uLightCenter + (2.0 * sampleUv.x - 1.0) * uLightU + (2.0 * sampleUv.y - 1.0) * uLightV;
      vec3 wi = normalize(point - primary.hit.position);
      float lightPdf = ptLightPdf(primary.hit.position, point), bsdfPdf;
      vec3 f = ptBsdf(material, primary.hit.shadingNormal, -ray.direction, wi, bsdfPdf);
      event.pdfsTerminal.xy += vec2(lightPdf, bsdfPdf) / 16.0;
      event.pdfsTerminal.z = 1.0;
      if (lightPdf <= 0.0 || !rtFinite(lightPdf) || !any(greaterThan(f, vec3(0.0)))) continue;
      Ray shadow;
      if (!ptShadowRay(primary.hit, point, shadow)) continue;
      QueryResult visibility = rtQueryMode(shadow, -1, 1);
      ++result.shadowRays; ptCosts(result, visibility);
      if (ptQueryFailure(result, visibility)) {
        event.pdfsTerminal.w = float(result.termination); event.contributionValid.w = 0.0;
        ptRecord(result, event, selectedEvent); return result;
      }
      if (visibility.status == RT_MISS) ptAdd(result, event,
        f * uLightEmission * max(dot(primary.hit.shadingNormal, wi), 0.0) / (16.0 * lightPdf));
    }
  }
  result.termination = PT_COMPLETE; event.pdfsTerminal.w = float(PT_COMPLETE);
  ptRecord(result, event, selectedEvent);
  return result;
}

vec4 ptDebugPixel(PTResult result, int column, int row) {
  if (row == 0) {
    if (column == 0) return vec4(result.radiance, float(result.status));
    if (column == 1) return vec4(float(result.primaryRays), float(result.continuationRays), float(result.shadowRays), float(result.primaryRays + result.continuationRays + result.shadowRays));
    if (column == 2) return vec4(float(result.nodes), float(result.tests), float(result.scattering), float(result.termination));
    if (column == 3) return vec4(float(min(result.pathEvents, PT_LOG_EVENTS)), float(result.pathEvents), result.pathEvents > PT_LOG_EVENTS ? 1.0 : 0.0, float(uMode));
    return vec4(0.0);
  }
  PTEvent event = result.selected;
  if (column == 0) return event.originEvent;
  if (column == 1) return event.directionPdf;
  if (column == 2) return event.positionPrimitive;
  if (column == 3) return event.normalObject;
  if (column == 4) return event.betaMaterial;
  if (column == 5) return event.pdfsTerminal;
  if (column == 6) return event.hitCosts;
  return event.contributionValid;
}

void main() {
  vec2 uv = uDebug != 0 ? uInspectUv : vUv;
  ivec2 pixel = ivec2(floor(uv * uResolution));
  int selectedEvent = uDebug != 0 ? int(floor(gl_FragCoord.y)) - 1 : -1;
  Ray ray = ptCameraRay(uv);
  PTResult result;
  if (uMode < 0 || uMode > 4 || uMaxScattering < 0 || uMaxScattering > PT_MAX_SCATTERING ||
      uEstimator < 0 || uEstimator > 2 || uSampling < 0 || uSampling > 1 ||
      !rtFinite3(uEnvironment) || !rtFinite3(uLightEmission) || !rtFinite(uOffsetScale) ||
      uOffsetScale < 0.0 || !rtFinite(uSceneScale)) {
    result = ptEmptyResult(); result.status = RT_INVALID; result.termination = PT_INVALID;
  } else if (uMode == 1) {
    result = ptVisibility(ray, pixel, selectedEvent);
  } else if (uMode == 2) {
    result = ptReflection(ray, selectedEvent);
  } else if (uMode == 4) {
    result = ptDirect(ray, pixel, selectedEvent);
  } else {
    result = ptPath(ray, pixel, selectedEvent);
  }
  if (!rtFinite3(result.radiance)) { result.status = RT_INVALID; result.termination = PT_INVALID; }
  if (uDebug != 0) { outColor = ptDebugPixel(result, int(floor(gl_FragCoord.x)), int(floor(gl_FragCoord.y))); return; }
  vec3 color = result.status == RT_OVERFLOW ? vec3(1.0, 0.18, 0.0) : result.status == RT_INVALID ? vec3(1.0, 0.0, 1.0) : result.radiance;
  outColor = vec4(color, result.status == 0 ? 1.0 : 0.0);
}
