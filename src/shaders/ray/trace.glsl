// Append to query.glsl. Geometry-only feasibility stage; output is linear RGB.
in vec2 vUv;
out vec4 outColor;

uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec2 uResolution;
uniform vec2 uInspectUv; // Bottom-left texture coordinates, matching vUv.
uniform float uRayMin;
uniform float uRayMax;
uniform int uDebug;
uniform int uView; // 0 material, 1 geometric normal, 2 distance, 3 query cost.
uniform int uOriginMode; // 0 camera, 1 spawn from camera hit, 2 inside test object.
uniform vec3 uTestOrigin;
uniform float uOffsetScale;
uniform float uSceneScale;

Ray rtCameraRay(vec2 uv) {
  // The renderer uses a perspective camera. Reconstruct a point at NDC z=0,
  // then transform its direction and normalize after the world transform.
  vec4 cameraPoint = uInvProjection * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vec3 cameraDirection = cameraPoint.xyz / cameraPoint.w;
  Ray ray;
  ray.origin = (uCameraWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  ray.direction = normalize(mat3(uCameraWorld) * cameraDirection);
  ray.tMin = uRayMin;
  ray.tMax = uRayMax;
  return ray;
}

vec4 rtDebugPixel(QueryResult result, Ray ray, int pixel) {
  Hit h = result.hit;
  if (pixel == 0) return vec4(h.t, float(h.primitiveId), float(h.objectId), float(h.materialId));
  if (pixel == 1) return vec4(h.position, float(result.status));
  if (pixel == 2) return vec4(h.geometricNormal, h.frontFace ? 1.0 : 0.0);
  if (pixel == 3) return vec4(float(result.nodeVisits), float(result.primitiveTests), float(result.eventCount), result.logTruncated ? 1.0 : 0.0);
  if (pixel == 4) return vec4(ray.origin, ray.tMin);
  if (pixel == 5) return vec4(ray.direction, ray.tMax);
  // Appended after the 256 event texels; columns 0..261 retain their ABI.
  if (pixel == 262) return vec4(h.barycentric, h.hit ? 1.0 : 0.0);
  return result.event;
}

vec3 rtGeometryColor(Ray ray, QueryResult result) {
  if (result.status == RT_OVERFLOW) return vec3(1.0, 0.18, 0.0);
  if (result.status == RT_INVALID) return vec3(1.0, 0.0, 1.0);
  if (uView == 3) {
    float cost = clamp(log2(1.0 + float(result.primitiveTests)) / 8.0, 0.0, 1.0);
    return mix(vec3(0.015, 0.06, 0.10), vec3(0.96, 0.28, 0.035), cost);
  }
  if (result.status == RT_MISS) return mix(vec3(0.018, 0.031, 0.050), vec3(0.055, 0.085, 0.105), clamp(ray.direction.y * 0.5 + 0.5, 0.0, 1.0));
  Hit h = result.hit;
  if (uView == 1) return h.geometricNormal * 0.5 + 0.5;
  if (uView == 2) return vec3(clamp(h.t / max(1e-6, uRayMax), 0.0, 1.0));
  vec3 albedo = texelFetch(tMaterials, ivec2(0, h.materialId), 0).rgb;
  vec3 emission = texelFetch(tMaterials, ivec2(1, h.materialId), 0).rgb;
  vec3 lightDirection = normalize(vec3(-0.55, 0.85, 0.65));
  float diffuse = max(0.0, dot(h.shadingNormal, lightDirection));
  return albedo * (0.18 + 0.82 * diffuse) + emission;
}

void main() {
  int pixel = int(floor(gl_FragCoord.x));
  // Every debug fragment independently executes the same complete query. The
  // requested log event only selects readback; it never changes traversal work.
  vec2 rayUv = uDebug != 0 ? uInspectUv : vUv;
  Ray ray = rtCameraRay(rayUv);
  int selectedEvent = uDebug != 0 ? pixel - 6 : -1;
  QueryResult result;
  if (uOriginMode == 1) {
    QueryResult primary = rtQueryMode(ray, -1, 0);
    if (primary.status == RT_HIT) {
      ray.origin = primary.hit.position;
      ray.direction = normalize(vec3(0.4, 1.0, 0.2));
      vec3 offset = rtOffsetOrigin(ray.origin, primary.hit.geometricNormal, ray.direction, uSceneScale) - ray.origin;
      ray.origin += offset * uOffsetScale;
      result = rtQuery(ray, selectedEvent);
    } else {
      // No surface means no secondary query. Preserve an invalid/overflow
      // diagnostic, and return an ordinary miss if the primary missed.
      result = primary;
      if (primary.status == RT_MISS) result = rtEmptyResult();
    }
  } else if (uOriginMode == 2) {
    ray.origin = uTestOrigin;
    result = rtQuery(ray, selectedEvent);
  } else if (uOriginMode == 0) {
    result = rtQuery(ray, selectedEvent);
  } else {
    result = rtEmptyResult();
    result.status = RT_INVALID;
  }
  if (uDebug != 0) {
    outColor = rtDebugPixel(result, ray, pixel);
    return;
  }
  bool valid = result.status == RT_HIT || result.status == RT_MISS;
  outColor = vec4(rtGeometryColor(ray, result), valid ? 1.0 : 0.0);
}
