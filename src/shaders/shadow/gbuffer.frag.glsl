precision highp float;
in vec3 vWorldPosition;
uniform vec3 uAlbedo;
uniform float uObjectId;
layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outNormal;
layout(location = 2) out vec4 outAlbedo;
void main() {
  // Derivatives recover each rasterized triangle's geometric normal, including
  // faceted spheres. Correct the back face to preserve the original winding.
  vec3 geometricNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
  if (!gl_FrontFacing) geometricNormal = -geometricNormal;
  outPosition = vec4(vWorldPosition, uObjectId + 1.0);
  outNormal = vec4(geometricNormal, 1.0);
  outAlbedo = vec4(uAlbedo, 1.0);
}
