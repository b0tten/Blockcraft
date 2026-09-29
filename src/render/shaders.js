// GLSL ES 3.00 shaders.

const LIGHT_FN = /* glsl */ `
float lightCurve(float l) {
  float b = pow(0.82, (1.0 - l) * 15.0);
  return mix(b, sqrt(b), 0.3); // mild gamma lift so dark areas stay readable
}
vec3 shadeLight(float sky, float blk, float sunlight, vec3 skyTint) {
  float s = lightCurve(sky * sunlight);
  float b = lightCurve(blk);
  vec3 c = max(vec3(s) * skyTint, vec3(b) * vec3(1.0, 0.86, 0.66));
  return max(c, vec3(0.045));
}
`;

export const CHUNK_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in float a_layer;
layout(location = 2) in vec4 a_uvfa;
layout(location = 3) in vec2 a_light;
uniform mat4 u_viewProj;
uniform vec3 u_offset;
uniform vec2 u_chunkWorld;
uniform float u_time;
out vec3 v_uv;
out float v_shade;
out vec2 v_light;
out float v_fog;
const float SHADE[8] = float[8](0.62, 0.62, 1.0, 0.5, 0.8, 0.8, 0.9, 1.0);
const float AO[4] = float[4](0.42, 0.62, 0.8, 1.0);
void main() {
  vec3 local = a_pos / 16.0;
  vec3 p = local + u_offset;
  int f = int(a_uvfa.z + 0.5);
  int face = f & 7;
  int flags = f >> 3;
  vec2 uv = a_uvfa.xy / 16.0;
  if ((flags & 3) != 0) {
    vec3 w = vec3(u_chunkWorld.x, 0.0, u_chunkWorld.y) + local;
    float ph = u_time * 1.7 + w.x * 0.61 + w.z * 0.47 + w.y * 0.33;
    float amp = (flags & 1) != 0 ? 0.07 : 0.022;
    p.x += sin(ph) * amp;
    p.z += cos(ph * 0.83 + 1.3) * amp;
  }
  if ((flags & 4) != 0) uv.y -= fract(u_time * 0.035);
  v_uv = vec3(uv, a_layer);
  v_shade = SHADE[face] * AO[int(a_uvfa.w + 0.5)];
  v_light = a_light / 255.0;
  v_fog = length(p.xz);
  gl_Position = u_viewProj * vec4(p, 1.0);
}`;

export const CHUNK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_sunlight;
uniform vec3 u_skyTint;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
uniform float u_alphaCut;
in vec3 v_uv;
in float v_shade;
in vec2 v_light;
in float v_fog;
out vec4 outColor;
${LIGHT_FN}
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (c.a < u_alphaCut) discard;
  vec3 col = c.rgb * shadeLight(v_light.x, v_light.y, u_sunlight, u_skyTint) * v_shade;
  float fog = smoothstep(u_fogRange.x, u_fogRange.y, v_fog);
  outColor = vec4(mix(col, u_fogColor, fog), c.a);
}`;

export const SKY_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 v_ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_ndc = p;
  gl_Position = vec4(p, 0.99999, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 u_invViewProj;
uniform vec3 u_sunDir;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_sunsetColor;
uniform float u_sunset;
uniform float u_stars;
uniform float u_time;
in vec2 v_ndc;
out vec4 outColor;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec4 p = u_invViewProj * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  float h = dir.y;
  vec3 col = mix(u_horizon, u_zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  if (h < 0.0) col = mix(u_horizon, u_horizon * 0.75, clamp(-h * 4.0, 0.0, 1.0));
  // Sunset glow around the sun near the horizon.
  float sd = max(dot(dir, u_sunDir), 0.0);
  col += u_sunsetColor * u_sunset * pow(sd, 6.0) * (1.0 - clamp(abs(h) * 2.2, 0.0, 1.0));
  // Stars.
  if (u_stars > 0.0 && h > 0.0) {
    vec3 cell = floor(dir * 220.0);
    float s = hash(cell);
    if (s > 0.9975) col += vec3(0.9, 0.92, 1.0) * u_stars * (s - 0.9975) * 400.0 * clamp(h * 3.0, 0.0, 1.0);
  }
  // Square sun and moon (gnomonic projection around the sun direction).
  vec3 right = vec3(0.0, 0.0, 1.0);
  vec3 up = normalize(cross(right, u_sunDir));
  float ds = dot(dir, u_sunDir);
  if (ds > 0.0) {
    vec2 q = vec2(dot(dir, right), dot(dir, up)) / ds;
    float m = max(abs(q.x), abs(q.y));
    if (m < 0.075) col = mix(col, vec3(1.0, 0.98, 0.82), 1.0);
    else col += vec3(1.0, 0.8, 0.5) * 0.35 * pow(max(0.0, 1.0 - m * 4.0), 2.0) * (1.0 - u_stars);
  } else {
    vec2 q = vec2(dot(dir, right), dot(dir, up)) / -ds;
    float m = max(abs(q.x), abs(q.y));
    if (m < 0.055) {
      float shade = (q.x > 0.02 || q.y < -0.03) ? 0.78 : 0.95;
      col = mix(col, vec3(0.86, 0.88, 0.95) * shade, 1.0);
    }
  }
  outColor = vec4(col, 1.0);
}`;

export const CLOUD_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat4 u_viewProj;
uniform float u_height;
uniform float u_extent;
out vec2 v_xz;
void main() {
  vec2 xz = a_pos * u_extent;
  v_xz = xz;
  gl_Position = u_viewProj * vec4(xz.x, u_height, xz.y, 1.0);
}`;

export const CLOUD_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_clouds;
uniform vec2 u_offset;
uniform vec3 u_color;
uniform vec3 u_fogColor;
uniform float u_extent;
in vec2 v_xz;
out vec4 outColor;
void main() {
  vec2 uv = (v_xz + u_offset) / (12.0 * 64.0);
  float c = texture(u_clouds, uv).r;
  if (c < 0.5) discard;
  float d = length(v_xz) / u_extent;
  float fade = 1.0 - smoothstep(0.45, 1.0, d);
  outColor = vec4(mix(u_fogColor, u_color, fade), 0.8 * fade);
}`;

export const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
uniform mat4 u_viewProj;
uniform vec3 u_min;
uniform vec3 u_max;
void main() {
  gl_Position = u_viewProj * vec4(mix(u_min, u_max, a_pos), 1.0);
}`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

// Dynamic textured geometry: particles, entities, held item.
export const SPRITE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_uvl;
layout(location = 2) in vec2 a_light;
uniform mat4 u_viewProj;
out vec3 v_uvl;
out vec2 v_light;
out float v_fog;
void main() {
  v_uvl = a_uvl;
  v_light = a_light;
  v_fog = length(a_pos.xz);
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`;

export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
in vec3 v_uvl;
in vec2 v_light;
in float v_fog;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uvl);
  if (c.a < 0.5) discard;
  vec3 col = mix(c.rgb * v_light.x, vec3(1.0), v_light.y);
  float fog = smoothstep(u_fogRange.x, u_fogRange.y, v_fog);
  outColor = vec4(mix(col, u_fogColor, fog), 1.0);
}`;

export { LIGHT_FN };
