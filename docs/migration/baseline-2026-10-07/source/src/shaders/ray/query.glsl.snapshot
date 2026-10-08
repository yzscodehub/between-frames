// GLSL ES 3.00 shared query kernel. Prepend to trace.glsl; the host supplies
// #version 300 es through THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3 }).
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tNodes;
uniform sampler2D tPrimitives;
uniform sampler2D tMaterials;
uniform int uNodeCount;
uniform int uPrimitiveCount;
uniform int uTraversal; // 0: ordered brute force, 1: BVH.
uniform int uAnyHit;    // 0: closest hit, 1: terminate on any accepted hit.
uniform int uLogBudget;

const int RT_MAX_PRIMITIVES = 2048;
const int RT_MAX_NODE_VISITS = 4095;
const int RT_STACK_CAPACITY = 64;
const int RT_MAX_EVENTS = 256;
const int RT_MISS = 0;
const int RT_HIT = 1;
const int RT_OVERFLOW = 2;
const int RT_INVALID = 3;

struct Ray {
  vec3 origin;
  vec3 direction; // Unit length, in world space. Therefore t is world distance.
  float tMin;
  float tMax;
};

struct Hit {
  bool hit;
  float t;
  vec3 position;
  vec3 geometricNormal; // Winding/outward normal; never face-forwarded.
  vec3 shadingNormal;   // Oriented to oppose the incoming ray.
  bool frontFace;
  int primitiveId;
  int objectId;
  int materialId;
  vec3 barycentric;     // (a,b,c) for triangles; (1,0,0) for spheres.
};

struct QueryResult {
  Hit hit;
  int status;
  int nodeVisits;
  int primitiveTests;
  int eventCount; // Number recorded, not the number of traversal iterations.
  bool logTruncated;
  vec4 event; // Selected event: node ID, tEnter, tExit, 0 culled / 1 branch / 2 leaf.
};

bool rtFinite(float v) { return !isnan(v) && !isinf(v); }
bool rtFinite3(vec3 v) { return !any(isnan(v)) && !any(isinf(v)); }
bool rtInteger(float v) { return rtFinite(v) && abs(v) <= 16777216.0 && floor(v) == v; }

Hit rtEmptyHit() {
  Hit h;
  h.hit = false;
  h.t = -1.0;
  h.position = vec3(0.0);
  h.geometricNormal = vec3(0.0);
  h.shadingNormal = vec3(0.0);
  h.frontFace = false;
  h.primitiveId = -1;
  h.objectId = -1;
  h.materialId = -1;
  h.barycentric = vec3(0.0);
  return h;
}

QueryResult rtEmptyResult() {
  QueryResult q;
  q.hit = rtEmptyHit();
  q.status = RT_MISS;
  q.nodeVisits = 0;
  q.primitiveTests = 0;
  q.eventCount = 0;
  q.logTruncated = false;
  q.event = vec4(-1.0, 0.0, 0.0, -1.0);
  return q;
}

bool rtValidRay(Ray ray) {
  return rtFinite3(ray.origin) && rtFinite3(ray.direction) &&
    abs(dot(ray.direction, ray.direction) - 1.0) <= 0.002 &&
    rtFinite(ray.tMin) && rtFinite(ray.tMax) &&
    ray.tMin >= 0.0 && ray.tMax >= ray.tMin;
}

float rtTieTolerance(float a, float b) {
  return 1e-6 * max(1.0, max(abs(a), abs(b)));
}

bool rtWins(Hit candidate, Hit best) {
  if (!best.hit) return true;
  float tolerance = rtTieTolerance(candidate.t, best.t);
  return candidate.t < best.t - tolerance ||
    (abs(candidate.t - best.t) <= tolerance && candidate.primitiveId < best.primitiveId);
}

float rtQueryMax(Ray ray, Hit best) {
  // Keep the tie interval visible to nodes and primitives in either ordering.
  return best.hit ? min(ray.tMax, best.t + rtTieTolerance(best.t, best.t)) : ray.tMax;
}

vec3 rtOffsetOrigin(vec3 position, vec3 geometricNormal, vec3 nextDirection, float sceneScale) {
  // Match the CPU oracle's scale policy. The geometric normal controls which
  // side of the surface is entered, including back-face hits.
  float scale = max(max(abs(sceneScale), 1e-3), max(abs(position.x), max(abs(position.y), abs(position.z))));
  float offset = 2e-5 * scale;
  float side = dot(nextDirection, geometricNormal) >= 0.0 ? 1.0 : -1.0;
  return position + side * offset * geometricNormal;
}

bool rtAabb(Ray ray, vec3 lo, vec3 hi, float limit, out float enter, out float leave) {
  enter = ray.tMin;
  leave = limit;
  for (int axis = 0; axis < 3; ++axis) {
    // Exact zero avoids 0*infinity and preserves slab-edge inclusivity.
    if (ray.direction[axis] == 0.0) {
      if (ray.origin[axis] < lo[axis] || ray.origin[axis] > hi[axis]) return false;
    } else {
      float a = (lo[axis] - ray.origin[axis]) / ray.direction[axis];
      float b = (hi[axis] - ray.origin[axis]) / ray.direction[axis];
      enter = max(enter, min(a, b));
      leave = min(leave, max(a, b));
      if (enter > leave) return false;
    }
  }
  return enter <= leave;
}

bool rtNode(int index, out vec3 lo, out vec3 hi, out int first, out int second, out bool leaf) {
  if (index < 0 || index >= uNodeCount) return false;
  vec4 a = texelFetch(tNodes, ivec2(0, index), 0);
  vec4 b = texelFetch(tNodes, ivec2(1, index), 0);
  lo = a.xyz;
  hi = b.xyz;
  if (!rtFinite3(lo) || !rtFinite3(hi) || any(greaterThan(lo, hi)) ||
      !rtInteger(a.w) || !rtInteger(b.w)) return false;
  leaf = a.w < 0.0;
  first = leaf ? -int(a.w) - 1 : int(a.w);
  second = int(b.w);
  if (leaf) return first >= 0 && second > 0 && first < uPrimitiveCount && second <= uPrimitiveCount - first;
  return first >= 0 && second >= 0 && first < uNodeCount && second < uNodeCount && first != second;
}

// Moller-Trumbore intentionally differs from the CPU plane/barycentric oracle.
// A degenerate triangle is a miss; malformed texture data is explicitly invalid.
bool rtPrimitive(Ray ray, int index, out Hit h, out bool valid) {
  h = rtEmptyHit();
  valid = false;
  if (index < 0 || index >= uPrimitiveCount) return false;
  vec4 a = texelFetch(tPrimitives, ivec2(0, index), 0);
  vec4 b = texelFetch(tPrimitives, ivec2(1, index), 0);
  vec4 c = texelFetch(tPrimitives, ivec2(2, index), 0);
  vec4 previous = texelFetch(tPrimitives, ivec2(3, index), 0);
  float id = texelFetch(tPrimitives, ivec2(4, index), 0).x;
  if (!rtFinite3(a.xyz) || !rtFinite3(b.xyz) || !rtFinite3(c.xyz) ||
      !rtInteger(id) || id < 0.0 || !rtInteger(previous.w) || previous.w < 0.0 ||
      !rtInteger(c.w) || c.w < 0.0 || c.w >= float(textureSize(tMaterials, 0).y) ||
      (a.w != 0.0 && a.w != 1.0)) return false;
  valid = true;
  float t;
  vec3 normal;
  vec3 barycentric = vec3(1.0, 0.0, 0.0);
  if (a.w == 0.0) {
    vec3 e1 = b.xyz - a.xyz;
    vec3 e2 = c.xyz - a.xyz;
    vec3 unnormalizedNormal = cross(e1, e2);
    float area = length(unnormalizedNormal);
    if (!rtFinite(area)) { valid = false; return false; }
    if (area == 0.0) return false;
    vec3 p = cross(ray.direction, e2);
    float determinant = dot(e1, p);
    if (abs(determinant) <= 1e-8 * area) return false;
    float inverseDeterminant = 1.0 / determinant;
    vec3 relative = ray.origin - a.xyz;
    float u = dot(relative, p) * inverseDeterminant;
    vec3 q = cross(relative, e1);
    float v = dot(ray.direction, q) * inverseDeterminant;
    t = dot(e2, q) * inverseDeterminant;
    if (!rtFinite(t) || !rtFinite(u) || !rtFinite(v)) { valid = false; return false; }
    if (u < 0.0 || v < 0.0 || u + v > 1.0 || t < ray.tMin || t > ray.tMax) return false;
    normal = unnormalizedNormal / area;
    barycentric = vec3(1.0 - u - v, u, v);
  } else {
    float radius = b.w;
    if (!rtFinite(radius) || radius <= 0.0) { valid = false; return false; }
    vec3 relative = ray.origin - a.xyz;
    float quadraticA = dot(ray.direction, ray.direction);
    float halfB = dot(relative, ray.direction);
    // Work near the sphere, avoiding cancellation in halfB^2 - A*C when a
    // small sphere is far from the ray origin. The CPU oracle independently
    // retains double-precision quadratic roots.
    float closestT = -halfB / quadraticA;
    vec3 perpendicular = relative + closestT * ray.direction;
    float radialSquared = radius * radius - dot(perpendicular, perpendicular);
    if (!rtFinite(closestT) || !rtFinite(radialSquared)) { valid = false; return false; }
    if (radialSquared < 0.0) return false;
    float span = sqrt(radialSquared / quadraticA);
    float t0 = closestT - span;
    float t1 = closestT + span;
    t = t0;
    if (t < ray.tMin || t > ray.tMax) t = t1;
    if (!rtFinite(t)) { valid = false; return false; }
    if (t < ray.tMin || t > ray.tMax) return false;
    // Reuse the nearby coordinates for the normal rather than subtracting the
    // center from a separately rounded world-space hit position.
    normal = normalize(perpendicular + (t - closestT) * ray.direction);
  }
  h.hit = true;
  h.t = t;
  h.position = ray.origin + t * ray.direction;
  h.geometricNormal = normal;
  h.frontFace = dot(ray.direction, normal) < 0.0;
  h.shadingNormal = h.frontFace ? normal : -normal;
  h.primitiveId = int(id);
  h.objectId = int(previous.w);
  h.materialId = int(c.w);
  h.barycentric = barycentric;
  if (!rtFinite3(h.position) || !rtFinite3(normal)) { valid = false; return false; }
  return true;
}

void rtRecordEvent(inout QueryResult result, int selectedEvent, int nodeId, float enter, float leave, int type) {
  int budget = clamp(uLogBudget, 0, RT_MAX_EVENTS);
  if (result.eventCount < budget) {
    if (result.eventCount == selectedEvent) result.event = vec4(float(nodeId), enter, leave, float(type));
    ++result.eventCount;
  } else {
    result.logTruncated = true;
  }
}

QueryResult rtQueryMode(Ray ray, int selectedEvent, int anyHit) {
  QueryResult result = rtEmptyResult();
  if (!rtValidRay(ray) || uPrimitiveCount < 0 || uNodeCount < 0 ||
      (uTraversal != 0 && uTraversal != 1) || (anyHit != 0 && anyHit != 1)) {
    result.status = RT_INVALID;
    return result;
  }
  if (uPrimitiveCount > RT_MAX_PRIMITIVES || uNodeCount > RT_MAX_NODE_VISITS) {
    result.status = RT_OVERFLOW;
    return result;
  }
  if (uPrimitiveCount == 0) return result;
  ivec2 primitiveSize = textureSize(tPrimitives, 0);
  ivec2 materialSize = textureSize(tMaterials, 0);
  if (primitiveSize.x < 6 || primitiveSize.y < uPrimitiveCount || materialSize.x < 3 || materialSize.y < 1) {
    result.status = RT_INVALID;
    return result;
  }
  if (uTraversal == 0) {
    for (int index = 0; index < RT_MAX_PRIMITIVES; ++index) {
      if (index >= uPrimitiveCount) break;
      Ray limitedRay = ray;
      limitedRay.tMax = rtQueryMax(ray, result.hit);
      Hit candidate;
      bool valid;
      ++result.primitiveTests;
      bool found = rtPrimitive(limitedRay, index, candidate, valid);
      if (!valid) { result.status = RT_INVALID; return result; }
      if (found && rtWins(candidate, result.hit)) {
        result.hit = candidate;
        result.status = RT_HIT;
        if (anyHit == 1) return result;
      }
    }
    return result;
  }
  ivec2 nodeSize = textureSize(tNodes, 0);
  if (uNodeCount == 0 || nodeSize.x < 2 || nodeSize.y < uNodeCount) {
    result.status = RT_INVALID;
    return result;
  }
  int stack[RT_STACK_CAPACITY];
  int stackSize = 1;
  stack[0] = 0;
  for (int iteration = 0; iteration < RT_MAX_NODE_VISITS; ++iteration) {
    if (stackSize == 0) return result;
    int nodeId = stack[--stackSize];
    ++result.nodeVisits;
    vec3 lo, hi;
    int first, second;
    bool leaf;
    if (!rtNode(nodeId, lo, hi, first, second, leaf)) { result.status = RT_INVALID; return result; }
    float enter, leave;
    bool intersects = rtAabb(ray, lo, hi, rtQueryMax(ray, result.hit), enter, leave);
    rtRecordEvent(result, selectedEvent, nodeId, enter, leave, intersects ? (leaf ? 2 : 1) : 0);
    if (!intersects) continue;
    if (leaf) {
      for (int offset = 0; offset < RT_MAX_PRIMITIVES; ++offset) {
        if (offset >= second) break;
        Ray limitedRay = ray;
        limitedRay.tMax = rtQueryMax(ray, result.hit);
        Hit candidate;
        bool valid;
        ++result.primitiveTests;
        bool found = rtPrimitive(limitedRay, first + offset, candidate, valid);
        if (!valid) { result.status = RT_INVALID; return result; }
        if (found && rtWins(candidate, result.hit)) {
          result.hit = candidate;
          result.status = RT_HIT;
          if (anyHit == 1) return result;
        }
      }
    } else {
      vec3 leftLo, leftHi, rightLo, rightHi;
      int unusedFirst, unusedSecond;
      bool unusedLeaf;
      if (!rtNode(first, leftLo, leftHi, unusedFirst, unusedSecond, unusedLeaf) ||
          !rtNode(second, rightLo, rightHi, unusedFirst, unusedSecond, unusedLeaf)) {
        result.status = RT_INVALID;
        return result;
      }
      float leftEnter, leftLeave, rightEnter, rightLeave;
      float limit = rtQueryMax(ray, result.hit);
      bool leftHit = rtAabb(ray, leftLo, leftHi, limit, leftEnter, leftLeave);
      bool rightHit = rtAabb(ray, rightLo, rightHi, limit, rightEnter, rightLeave);
      int needed = (leftHit ? 1 : 0) + (rightHit ? 1 : 0);
      if (stackSize + needed > RT_STACK_CAPACITY) { result.status = RT_OVERFLOW; return result; }
      if (leftHit && rightHit) {
        // LIFO: far child first. A tie visits the left child first.
        bool leftNear = leftEnter <= rightEnter;
        stack[stackSize++] = leftNear ? second : first;
        stack[stackSize++] = leftNear ? first : second;
      } else if (leftHit) {
        stack[stackSize++] = first;
      } else if (rightHit) {
        stack[stackSize++] = second;
      }
    }
  }
  // A partial hit is preserved for diagnosis but MUST NOT be treated as success.
  if (stackSize > 0) result.status = RT_OVERFLOW;
  return result;
}

QueryResult rtQuery(Ray ray, int selectedEvent) {
  return rtQueryMode(ray, selectedEvent, uAnyHit);
}
