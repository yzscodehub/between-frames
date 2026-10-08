precision highp float;
out vec4 outColor;
void main() {
  // Color is only a diagnostic companion. Sampling always uses the actual
  // DepthTexture written by rasterization and the fixed-function depth test.
  outColor = vec4(vec3(gl_FragCoord.z), 1.0);
}
