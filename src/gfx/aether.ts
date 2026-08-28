/**
 * The aether — the ambient field behind everything.
 *
 * A single fullscreen WebGL2 fragment shader. Raw WebGL rather than three.js on
 * purpose: this is one quad and one shader, and a library for that would cost
 * more in bundle than the whole rest of the app.
 *
 * What it is: a domain-warped flow field with rune-like filaments drifting
 * through it, tinted by whichever element the player is currently living in.
 * It is deliberately slow and low-contrast — it is the room, not the subject.
 *
 * It reacts to two things:
 *   - `element`, which crossfades the hue when a player joins a faction or
 *     enters a fight;
 *   - `shock`, a shockwave fired from combat, which ripples outward from the
 *     point of impact.
 *
 * Everything degrades honestly: no WebGL2, reduced motion, or a lost context,
 * and the page simply has a plain dark background. Nothing here is load-bearing.
 */

export type Element = 'fire' | 'water' | 'air' | 'rock' | 'arcane';

/** The chroma each element brings. Matches the CSS tokens in index.css. */
const HUES: Record<Element, [number, number, number]> = {
  arcane: [0.58, 0.47, 1.0],
  fire: [1.0, 0.45, 0.22],
  water: [0.24, 0.66, 1.0],
  air: [0.44, 0.9, 0.76],
  rock: [0.82, 0.64, 0.34],
};

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uHue;      // current element colour
uniform vec3  uHuePrev;  // the one being crossfaded out
uniform float uBlend;    // 0..1 across the crossfade
uniform vec3  uShock;    // xy = origin in clip space, z = age in seconds (<0 = idle)

// -- noise ------------------------------------------------------------------
// Value noise + fbm. Cheap, and the softness suits a field of drifting aether
// better than the harder edges of simplex.

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Four octaves. The fifth adds detail finer than a half-resolution buffer can
// resolve, and fbm is called five times per pixel, so it was costing a fifth of
// the shader for something invisible.
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;          // not exactly 2, to avoid the grid showing through
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  // Aspect-corrected, centred coordinates.
  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);

  float t = uTime * 0.035;

  // Domain warp: sample the field at a position that is itself displaced by the
  // field. This is what stops it reading as generic clouds — the filaments fold
  // over each other instead of drifting in parallel.
  vec2 w1 = vec2(fbm(q * 1.6 + vec2(0.0, t)),
                 fbm(q * 1.6 + vec2(5.2, -t * 0.8)));
  vec2 w2 = vec2(fbm(q * 2.4 + 3.4 * w1 + vec2(1.7, t * 1.3)),
                 fbm(q * 2.4 + 3.4 * w1 + vec2(8.3, -t)));
  float field = fbm(q * 2.0 + 4.0 * w2);

  // Filaments: the ridges of the warped field, thin and bright. These are the
  // "runes in the air" — the thing that makes it feel inscribed rather than
  // atmospheric.
  float ridge = 1.0 - abs(field - 0.5) * 2.0;
  float filament = pow(clamp(ridge, 0.0, 1.0), 22.0);

  // The shockwave: an expanding ring from the point of impact.
  float shock = 0.0;
  if (uShock.z >= 0.0) {
    vec2 sp = (uShock.xy * 0.5 + 0.5) * uRes;
    vec2 sq = (sp - 0.5 * uRes) / min(uRes.x, uRes.y);
    float d = length(q - sq);
    float age = uShock.z;
    float radius = age * 1.5;
    float ring = exp(-pow((d - radius) * 9.0, 2.0));
    shock = ring * exp(-age * 2.6);
  }

  vec3 hue = mix(uHuePrev, uHue, uBlend);

  // Composite.
  //
  // The restraint here is the whole point. A first pass at these numbers was
  // roughly twice as strong and the filaments read as wallpaper — they competed
  // with the text instead of sitting behind it. This is the room, not the
  // subject: the element's chroma should be felt rather than looked at.
  vec3 col = vec3(0.026, 0.030, 0.046);
  col += hue * pow(field, 2.6) * 0.15;
  col += hue * filament * 0.20;
  col += hue * shock * 0.85;   // the shockwave is allowed to be loud; it is an event

  // A slow breath, so a still page is never quite still.
  col *= 0.93 + 0.07 * sin(uTime * 0.22);

  // Calm the middle. Content lives in a centred column, so the field is pushed
  // out to the margins where it can be atmospheric without being in the way.
  float centre = smoothstep(0.15, 0.85, length(vec2(q.x * 1.35, q.y)));
  col *= 0.45 + 0.55 * centre;

  // Vignette: and pull the far corners back down again.
  float vig = smoothstep(1.35, 0.30, length(q));
  col *= 0.5 + 0.5 * vig;

  // Dither. Without it, a gradient this dark bands visibly on most panels.
  float grain = (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.016;
  col += grain;

  fragColor = vec4(col, 1.0);
}`;

/*
 * Motes — the drifting particles.
 *
 * Every mote's position is a pure function of its seed and the clock, computed
 * in the vertex shader. Nothing is simulated on the CPU and no buffer is ever
 * re-uploaded: the whole system is one static seed buffer and one draw call, so
 * two thousand of them cost about as much as two.
 *
 * That constraint is also why they move the way they do. With no state to carry
 * between frames there is no integrator, so instead of velocity they follow a
 * closed-form curl-ish path — two out-of-phase sines at different frequencies,
 * which reads as drift rather than as orbiting.
 *
 * They answer the same shockwave the field does: a mote near the impact is
 * pushed outward and brightened, and eases back as the wave passes. That is the
 * point of having them — the background should flinch when something lands.
 */
const MOTE_COUNT = 2000;

const MOTE_VERT = `#version 300 es
in vec4 seed;          // x,y = home position (clip space); z = phase; w = size
uniform float uTime;
uniform vec3  uShock;  // xy = origin (clip space), z = age (<0 = idle)
uniform vec2  uRes;
out float vAlpha;

void main() {
  float t = uTime;
  vec2 p = seed.xy;
  float ph = seed.z * 6.2831853;

  // Closed-form drift. Two frequencies well apart, so the paths never
  // synchronise into a visible pulse.
  p.x += sin(t * 0.11 + ph) * 0.07 + sin(t * 0.043 + ph * 2.7) * 0.035;
  p.y += cos(t * 0.093 + ph * 1.3) * 0.06 + cos(t * 0.037 + ph * 3.1) * 0.03;

  // A slow global rise, wrapped — motes climb like embers and reappear below.
  p.y = fract((p.y + 1.0) * 0.5 + t * 0.0065) * 2.0 - 1.0;

  float lift = 0.0;
  if (uShock.z >= 0.0) {
    vec2 d = p - uShock.xy;
    float dist = length(d);
    float radius = uShock.z * 1.5;
    // Only the motes the wavefront is passing through move.
    float hit = exp(-pow((dist - radius) * 6.0, 2.0)) * exp(-uShock.z * 2.2);
    p += normalize(d + 1e-5) * hit * 0.16;
    lift = hit;
  }

  gl_Position = vec4(p, 0.0, 1.0);
  // Scale with the viewport so motes are not chunky on a phone and invisible on
  // a monitor.
  float px = min(uRes.x, uRes.y);
  gl_PointSize = seed.w * (px / 420.0) * (1.0 + lift * 2.2);
  vAlpha = (0.20 + seed.w * 0.11) * (1.0 + lift * 5.0);
}`;

const MOTE_FRAG = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uHue;
uniform vec3 uHuePrev;
uniform float uBlend;
out vec4 fragColor;

void main() {
  // Round, soft-edged points. gl_PointCoord is the only geometry available
  // here, so the falloff is what gives them shape.
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 2.2) * vAlpha;
  vec3 hue = mix(uHuePrev, uHue, uBlend);
  fragColor = vec4(hue * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`aether shader: ${log}`);
  }
  return sh;
}

export type AetherHandle = {
  /** Crossfade to another element's chroma. */
  setElement(element: Element): void;
  /** Fire a shockwave. `x`/`y` are viewport pixels. */
  shock(x: number, y: number): void;
  destroy(): void;
};

export function mountAether(canvas: HTMLCanvasElement): AetherHandle | null {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    alpha: false,
  });
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  } catch (err) {
    console.warn('aether disabled:', err);
    return null;
  }

  // The field: one fullscreen triangle.
  const fieldVao = gl.createVertexArray();
  gl.bindVertexArray(fieldVao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const u = {
    res: gl.getUniformLocation(program, 'uRes'),
    time: gl.getUniformLocation(program, 'uTime'),
    hue: gl.getUniformLocation(program, 'uHue'),
    huePrev: gl.getUniformLocation(program, 'uHuePrev'),
    blend: gl.getUniformLocation(program, 'uBlend'),
    shock: gl.getUniformLocation(program, 'uShock'),
  };

  // The motes. A separate program in the same context, drawn additively over
  // the field. If it fails to build, the field alone is still a complete
  // background — motes are the accent, not the substance.
  let motes: {
    program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer;
    u: Record<string, WebGLUniformLocation | null>;
  } | null = null;

  try {
    const mv = compile(gl, gl.VERTEX_SHADER, MOTE_VERT);
    const mf = compile(gl, gl.FRAGMENT_SHADER, MOTE_FRAG);
    const mp = gl.createProgram()!;
    gl.attachShader(mp, mv);
    gl.attachShader(mp, mf);
    gl.linkProgram(mp);
    if (!gl.getProgramParameter(mp, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(mp) ?? 'mote link failed');
    }
    gl.deleteShader(mv);
    gl.deleteShader(mf);

    // Seeds, uploaded once and never touched again.
    const seeds = new Float32Array(MOTE_COUNT * 4);
    for (let i = 0; i < MOTE_COUNT; i++) {
      seeds[i * 4 + 0] = Math.random() * 2 - 1;
      seeds[i * 4 + 1] = Math.random() * 2 - 1;
      seeds[i * 4 + 2] = Math.random();
      // Mostly small with a few large: a uniform size reads as a texture, a
      // skewed one reads as depth.
      seeds[i * 4 + 3] = 0.6 + Math.pow(Math.random(), 3) * 3.4;
    }
    const mbuf = gl.createBuffer()!;
    const mvao = gl.createVertexArray()!;
    gl.bindVertexArray(mvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mbuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    const sloc = gl.getAttribLocation(mp, 'seed');
    gl.enableVertexAttribArray(sloc);
    gl.vertexAttribPointer(sloc, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    motes = {
      program: mp, vao: mvao, buffer: mbuf,
      u: {
        time: gl.getUniformLocation(mp, 'uTime'),
        shock: gl.getUniformLocation(mp, 'uShock'),
        res: gl.getUniformLocation(mp, 'uRes'),
        hue: gl.getUniformLocation(mp, 'uHue'),
        huePrev: gl.getUniformLocation(mp, 'uHuePrev'),
        blend: gl.getUniformLocation(mp, 'uBlend'),
      },
    };
  } catch (err) {
    console.warn('motes disabled:', err);
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let hue = HUES.arcane;
  let huePrev = HUES.arcane;
  let blend = 1;
  let shockAt: [number, number] = [0, 0];
  let shockStart = -1;
  let raf = 0;
  let running = true;
  const startedAt = performance.now();

  const resize = () => {
    // Half resolution for the field, which is soft and low-frequency enough
    // that nobody can tell — it is the difference between a free effect and a
    // warm laptop. The motes are drawn at the same scale and are the reason it
    // is 0.6 rather than 0.5: below that they start to shimmer.
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
    const w = Math.max(1, Math.floor(window.innerWidth * scale));
    const h = Math.max(1, Math.floor(window.innerHeight * scale));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };
  resize();
  window.addEventListener('resize', resize);

  const draw = (now: number) => {
    const t = (now - startedAt) / 1000;
    const rawAge = shockStart < 0 ? -1 : (now - shockStart) / 1000;
    const age = rawAge > 2.2 ? -1 : rawAge;

    gl.useProgram(program);
    gl.bindVertexArray(fieldVao);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, t);
    gl.uniform3f(u.hue, hue[0], hue[1], hue[2]);
    gl.uniform3f(u.huePrev, huePrev[0], huePrev[1], huePrev[2]);
    gl.uniform1f(u.blend, blend);
    gl.uniform3f(u.shock, shockAt[0], shockAt[1], age);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (motes) {
      // Additive: motes are light, so they brighten what is behind them rather
      // than covering it.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(motes.program);
      gl.bindVertexArray(motes.vao);
      gl.uniform1f(motes.u.time, t);
      gl.uniform2f(motes.u.res, canvas.width, canvas.height);
      gl.uniform3f(motes.u.shock, shockAt[0], shockAt[1], age);
      gl.uniform3f(motes.u.hue, hue[0], hue[1], hue[2]);
      gl.uniform3f(motes.u.huePrev, huePrev[0], huePrev[1], huePrev[2]);
      gl.uniform1f(motes.u.blend, blend);
      gl.drawArrays(gl.POINTS, 0, MOTE_COUNT);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  };

  const loop = (now: number) => {
    if (!running) return;
    if (blend < 1) blend = Math.min(1, blend + 0.012);
    draw(now);
    raf = requestAnimationFrame(loop);
  };

  if (reduced) {
    // One frame, then stop. The field is still there; it just does not move.
    draw(performance.now());
  } else {
    raf = requestAnimationFrame(loop);
  }

  // A lost context must not take the page with it.
  const onLost = (e: Event) => { e.preventDefault(); running = false; cancelAnimationFrame(raf); };
  canvas.addEventListener('webglcontextlost', onLost);

  // Stop entirely when the tab is not visible. A decorative background has no
  // business holding the GPU awake behind another window, and browsers throttle
  // rAF unevenly rather than stopping it.
  const onVisibility = () => {
    if (reduced) return;
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      raf = requestAnimationFrame(loop);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setElement(element) {
      const next = HUES[element] ?? HUES.arcane;
      if (next === hue) return;
      huePrev = hue;
      hue = next;
      blend = 0;
      if (reduced) { blend = 1; draw(performance.now()); }
    },
    shock(x, y) {
      if (reduced) return;
      shockAt = [(x / window.innerWidth) * 2 - 1, 1 - (y / window.innerHeight) * 2];
      shockStart = performance.now();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(fieldVao);
      gl.deleteProgram(program);
      if (motes) {
        gl.deleteBuffer(motes.buffer);
        gl.deleteVertexArray(motes.vao);
        gl.deleteProgram(motes.program);
      }
    },
  };
}
