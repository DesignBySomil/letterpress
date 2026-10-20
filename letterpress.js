(() => {
'use strict';
const W = 1200, H = 1500;
const FS = 80, LH = 114, ML = 124, MR = 124, TOP = 262, MAXY = 1262, TRACK = 1.2;
const INKS = [[.075,.105,.17],[.30,.045,.055],[.05,.16,.10]];
const $ = id => document.getElementById(id);
const gl = $('gl').getContext('webgl2', {alpha:true, premultipliedAlpha:true, preserveDrawingBuffer:true, antialias:false});
if (!gl) { $('nogl').style.display = 'grid'; $('stage').style.display = 'none'; return; }
const glc = $('gl'), wrap = $('sheetWrap'), sheetEl = $('sheet'), caret = $('caret'), ta = $('ta');
const css = document.documentElement.style;
const setVh = () => css.setProperty('--vh', (window.visualViewport ? window.visualViewport.height : innerHeight) + 'px');
setVh(); addEventListener('resize', setVh); window.visualViewport && visualViewport.addEventListener('resize', setVh);

/* ---------- layers (R = depth, G = ink, B = ghost) ---------- */
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', {willReadFrequently:true}); x.fillStyle = '#000'; x.fillRect(0,0,W,H); return [c,x]; };
const [sC, sX] = mk(), [aC, aX] = mk();

/* ---------- shaders ---------- */
const VS = `#version 300 es
out vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = vec2(p.x, 1.-p.y); gl_Position = vec4(p*2.-1.,0.,1.); }`;
const FS_SRC = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uS, uA;
uniform vec2 uLight; uniform vec3 uInk; uniform float uTime, uSeed;
const vec2 SZ = vec2(1200., 1500.);
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.07+vec2(5.3,1.7); a*=.5; } return s; }
float grainH(vec2 px){
  float g = vn(px*.16)*.45 + vn(px*.42+9.)*.35 + vn(px*1.1+3.)*.20;
  float fa = vn(px*.0035+uSeed)*6.283; mat2 r = mat2(cos(fa),-sin(fa),sin(fa),cos(fa));
  vec2 q = r*px; float fib = smoothstep(.70,.96, vn(vec2(q.x*.03, q.y*.85)));
  return g*.75 + fib*.35;
}
vec4 lay(vec2 uv, float l){ return textureLod(uS,uv,l) + textureLod(uA,uv,l); }
void main(){
  vec2 px = vUv*SZ;
  vec2 e = vec2(2.2)/SZ;
  float dpt = lay(vUv,1.3).r;
  vec2 gd = vec2(lay(vUv+vec2(e.x,0.),1.3).r - lay(vUv-vec2(e.x,0.),1.3).r,
                 lay(vUv+vec2(0.,e.y),1.3).r - lay(vUv-vec2(0.,e.y),1.3).r);
  float g0 = grainH(px);
  vec2 gg = vec2(grainH(px+vec2(1.,0.))-g0, grainH(px+vec2(0.,1.))-g0);
  vec2 hg = -gd*20. + gg*.5;
  vec3 N = normalize(vec3(-hg, 1.));
  vec3 L = normalize(vec3((uLight - vUv)*vec2(1.,1.25)*1.5, .6));
  float shade = 1. + (dot(N,L) - L.z)*1.7;
  float lamp = length((vUv-uLight)*vec2(1.,1.25));
  shade *= .84 + .26*smoothstep(1.15,.0,lamp);
  vec3 Hh = normalize(L + vec3(0.,0.,1.));
  float spec = pow(max(dot(N,Hh),0.),70.) * (.12 + dpt*.9) * .55;

  vec3 col = mix(vec3(.94,.908,.842), vec3(.978,.955,.9), smoothstep(.25,.75,g0));
  float mott = fbm(px*.0045+uSeed*3.);
  col *= .955 + .075*mott;
  col -= vec3(.03,.035,.05)*smoothstep(.78,.97, vn(px*vec2(.7,.25)+uSeed*9.))*.6;
  col *= 1. - .07*dpt;

  vec4 s0 = lay(vUv,0.), sb = lay(vUv,1.9);
  float m = clamp(s0.g,0.,1.);
  float tooth = (vn(px*.9)+vn(px*2.3+5.))*.5 - .5;
  float cover = smoothstep(.34,.60, m + tooth*.42);
  float dens = clamp((m-.55)/.45,0.,1.);
  float a = cover*(.64+.36*dens);
  float dry = smoothstep(.55,.88, fbm(px*.05+11.+uSeed));
  a *= 1. - .20*dry;
  a *= 1. - smoothstep(.55,.8,vn(px*.7+1.))*.22;
  a *= 1. - .5*step(.9, vn(px*1.3+2.))*(1.-dens*.6);
  float rim = clamp(m - sb.g, 0., 1.);
  float bleed = clamp(sb.g - m, 0., 1.);
  a = clamp(a + bleed*.10*(.5+dens), 0., 1.);
  vec3 ic = uInk*(.82 + .30*dens) * (1. - rim*.45) + uInk*.5*rim*rim;
  ic += vec3(.16,.16,.2)*spec*4.;
  col = mix(col, uInk*.85+.12, smoothstep(.15,.7,s0.b)*.11);
  col = mix(col, ic, a);
  col = col*shade + vec3(1.,.97,.9)*spec*(1.-a*.55);

  // deckled edge
  float d = min(min(vUv.x,1.-vUv.x)*SZ.x, min(vUv.y,1.-vUv.y)*SZ.y);
  float wob = (fbm(px*.035)-.5)*16. + (vn(px*.5)-.5)*3.2 + (vn(px*.12+4.)-.5)*5.;
  float ed = d - 7. - wob;
  float alpha = smoothstep(-.6,1.6,ed);
  col = mix(col, vec3(.99,.975,.93), smoothstep(14.,0.,ed)*.45);
  col *= .96 + .04*smoothstep(0.,120.,d);
  col += (h21(px+uTime)-.5)/200.;
  outColor = vec4(col*alpha, alpha);
}`;
const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS_SRC)); gl.linkProgram(prog); gl.useProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
const U = n => gl.getUniformLocation(prog, n);
const uLight = U('uLight'), uInk = U('uInk'), uTime = U('uTime'), uSeed = U('uSeed');
gl.uniform1i(U('uS'), 0); gl.uniform1i(U('uA'), 1);
const mkTex = (unit, canvas) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D); return t; };
const sT = mkTex(0, sC), aT = mkTex(1, aC);
const upload = (unit, tex, ctx, r) => { // r = {x,y,w,h} or null for full
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
  if (!r) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
  else gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, gl.RGBA, gl.UNSIGNED_BYTE, ctx.getImageData(r.x, r.y, r.w, r.h));
  gl.generateMipmap(gl.TEXTURE_2D); };

/* ---------- state ---------- */
let inkIdx = 0, sheetNo = 1, seed = Math.random()*10, text = '', glyphs = [];
let cx = ML, line = 0, lastGlyph = null, busy = false, typedOnce = false;
const active = []; // {g, t0, ghost}
let prompt = null; // blind deboss
let dirty = null;  // dirty rect in A from the previous frame
const rnd = (a, b) => a + Math.random()*(b-a);
const fontOf = g => `${g.italic ? 'italic ' : ''}${g.size}px ${g.fam}`;
function glyph(ch, x, y, o = {}) {
  const g = {ch, x, y, size:o.size || FS, fam:o.fam || 'Fell', italic:!!o.italic, rot:rnd(-.0075,.0075), dy:rnd(-1.4,1.4), depth:o.depth || rnd(196,236), ink:o.ink || rnd(205,255)};
  sX.font = fontOf(g); g.w = sX.measureText(ch).width; return g;
}
function draw(ctx, g, hs, ks, inkOn = true, ghostAmt = 0, dx = 0, dy = 0) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.font = fontOf(g); ctx.textBaseline = 'alphabetic';
  ctx.translate(g.x + g.w/2 + dx, g.y + g.dy + dy); ctx.rotate(g.rot);
  if (hs > 0) { ctx.fillStyle = `rgb(${Math.min(255, g.depth*hs) | 0},0,0)`; ctx.fillText(g.ch, -g.w/2, 0); }
  if (inkOn) { ctx.save(); ctx.translate(0, -g.size*.3); ctx.scale(ks, ks); ctx.translate(0, g.size*.3); ctx.fillStyle = `rgb(0,${g.ink | 0},0)`; ctx.fillText(g.ch, -g.w/2, 0); ctx.restore(); }
  if (ghostAmt > 0) { ctx.fillStyle = `rgb(0,0,${Math.min(255, ghostAmt*255) | 0})`; ctx.fillText(g.ch, -g.w/2, 0); }
  ctx.restore();
}
const box = (g, pad = 26) => ({x0:Math.floor(g.x - pad), y0:Math.floor(g.y - g.size*1.05 - pad), x1:Math.ceil(g.x + g.w + pad), y1:Math.ceil(g.y + g.size*.45 + pad)});
const union = (a, b) => !a ? b : !b ? a : ({x0:Math.min(a.x0,b.x0), y0:Math.min(a.y0,b.y0), x1:Math.max(a.x1,b.x1), y1:Math.max(a.y1,b.y1)});
const clampR = b => { const x0 = Math.max(0,b.x0), y0 = Math.max(0,b.y0), x1 = Math.min(W,b.x1), y1 = Math.min(H,b.y1); return {x:x0, y:y0, w:Math.max(1,x1-x0), h:Math.max(1,y1-y0)}; };

function newSheet() {
  sX.fillStyle = '#000'; sX.fillRect(0,0,W,H); aX.fillStyle = '#000'; aX.fillRect(0,0,W,H);
  text = ''; glyphs = []; cx = ML; line = 0; lastGlyph = null; active.length = 0; dirty = null; typedOnce = false; seed = Math.random()*10;
  // printer's rule and colophon, already inked into the sheet
  sX.fillStyle = 'rgb(150,215,0)'; sX.fillRect(ML, 1352, W-ML-MR, 2.6);
  const cap = `PRESSED BY HAND  ·  № ${String(sheetNo).padStart(3,'0')}`;
  const sz = 25; sX.font = `${sz}px FellSC`; let tw = 0; for (const ch of cap) tw += sX.measureText(ch).width + 5.5;
  let x = (W - tw)/2;
  for (const ch of cap) { const g = glyph(ch, x, 1412, {size:sz, fam:'FellSC', depth:118, ink:228}); draw(sX, g, 1, 1); x += g.w + 5.5; }
  upload(0, sT, sX, null); upload(1, aT, aX, null);
  const f = lineFont(); prompt = null;
  place(); markCaret();
}
const lineFont = () => FS;
function place() { const c = $('caret'); c.style.left = (cx/W*100) + '%'; c.style.top = ((TOP + line*LH - FS*.8)/H*100) + '%'; c.style.height = (FS*1.0/H*100) + '%'; }
function markCaret() { caret.style.opacity = ''; }

function startPrompt() { // blind deboss that springs back on first key
  const s = 'type something'; const sz = 62; sX.font = `italic ${sz}px Fell`; let tw = 0; for (const ch of s) tw += sX.measureText(ch).width + 1;
  let x = (W - tw)/2; const gs = [];
  for (const ch of s) { const g = glyph(ch, x, 760, {size:sz, italic:true, depth:62}); gs.push(g); x += g.w + 1; }
  prompt = {gs, t0:performance.now(), t1:0};
}

/* ---------- typing ---------- */
function stamp(ch) {
  if (ch === '\n') { if (line + 1 > Math.floor((MAXY - TOP)/LH)) return fullSheet(); line++; cx = ML; lastGlyph = null; text += '\n'; place(); A.ding(); return true; }
  if (ch === '\t') ch = ' ';
  if (ch < ' ') return false;
  sX.font = `${FS}px Fell`; const w = sX.measureText(ch).width + TRACK;
  if (cx + w > W - MR && ch !== ' ') { if (line + 1 > Math.floor((MAXY - TOP)/LH)) return fullSheet(); line++; cx = ML; A.ding(); }
  if (ch === ' ') { if (cx + w > W - MR) { return true; } cx += w*1.0; text += ' '; place(); A.thump(.6); return true; }
  const g = glyph(ch, cx, TOP + line*LH);
  const ghost = lastGlyph ? {g:lastGlyph, dx:rnd(-4,4), dy:rnd(-3,3)} : null;
  active.push({g, t0:performance.now(), ghost}); glyphs.push(g);
  cx += g.w + TRACK; lastGlyph = g; text += ch; place();
  A.clack(ch); tick();
  if (!typedOnce) { typedOnce = true; if (prompt) prompt.t1 = performance.now(); hintOff(); }
  idleReset(); return true;
}
function fullSheet() { A.thump(1); shake(); showHint('sheet is full · press the brass key', true); return false; }

let inChain = false;
ta.addEventListener('input', () => {
  if (busy) { ta.value = text; return; }
  const v = ta.value;
  if (v.length > text.length && v.startsWith(text)) { for (const ch of v.slice(text.length)) { if (!stamp(ch)) break; } }
  else if (v !== text) { shake(); showHint('ink doesn’t erase · press the brass key for a fresh sheet', true); }
  ta.value = text; try { ta.setSelectionRange(text.length, text.length); } catch (e) {}
});
ta.addEventListener('keydown', e => { if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); shake(); A.thump(.5); showHint('ink doesn’t erase · press the brass key for a fresh sheet', true); } });
const focusTa = () => { try { ta.focus({preventScroll:true}); } catch (e) { ta.focus(); } };
glc.addEventListener('pointerdown', () => { focusTa(); A.init(); needOrient(); });
addEventListener('keydown', e => { if (document.activeElement !== ta && !e.metaKey && !e.ctrlKey && !e.altKey) focusTa(); A.init(); });
addEventListener('pointerdown', () => A.init(), {once:true});
document.addEventListener('visibilitychange', () => { if (!document.hidden) focusTa(); });
addEventListener('load', focusTa);

/* ---------- hint ---------- */
const hint = $('hint'); let hintT = 0, idleT = 0;
function showHint(t, force) { hint.textContent = t; hint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => hint.classList.remove('on'), force ? 2600 : 6000); }
function hintOff() { hint.classList.remove('on'); }
function idleReset() { clearTimeout(idleT); idleT = setTimeout(() => { if (glyphs.length > 6 && !busy) showHint('press the brass key to keep it'); }, 3200); }

/* ---------- shake ---------- */
function shake() { sheetEl.animate([{transform:'translateX(0)'},{transform:'translateX(-9px) rotate(-.4deg)'},{transform:'translateX(8px) rotate(.3deg)'},{transform:'translateX(-5px)'},{transform:'translateX(0)'}], {duration:300, easing:'ease-out'}); }

/* ---------- haptics ---------- */
const sw = document.createElement('label'); sw.style.cssText = 'position:fixed;left:-99px;top:-99px;opacity:0;pointer-events:none';
const swi = document.createElement('input'); swi.type = 'checkbox'; swi.setAttribute('switch', ''); sw.appendChild(swi); document.body.appendChild(sw);
function tick() { try { if (navigator.vibrate) navigator.vibrate(7); else sw.click(); } catch (e) {} }

/* ---------- sound (all synthesized) ---------- */
const A = (() => {
  let ctx, master, noise, comp;
  const init = () => { if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC();
    comp = ctx.createDynamicsCompressor(); master = ctx.createGain(); master.gain.value = .85; master.connect(comp); comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate*.6, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random()*2-1; };
  const nz = (t, dur, type, f0, f1, q, g0) => { const s = ctx.createBufferSource(); s.buffer = noise; s.playbackRate.value = rnd(.85,1.2);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t+dur); f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(.0001, t+dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (p) { p.pan.value = rnd(-.25,.25); s.connect(f); f.connect(g); g.connect(p); p.connect(master); } else { s.connect(f); f.connect(g); g.connect(master); }
    s.start(t, rnd(0,.3), dur+.02); };
  const osc = (t, type, f0, f1, dur, g0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t+dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(.0001, t+dur); o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+.02); };
  return {
    init,
    clack(ch) { if (!ctx) return; const t = ctx.currentTime; const big = /[A-Z]/.test(ch) ? 1.2 : 1;
      nz(t, .05, 'bandpass', rnd(1500,3200), 900, 1.4, .55*big); osc(t, 'sine', rnd(150,190), 52, .09, .55*big); osc(t, 'square', rnd(2600,3600), 1800, .004, .07); nz(t+.012, .03, 'highpass', 5000, 3000, .7, .08); },
    thump(v = 1) { if (!ctx) return; const t = ctx.currentTime; osc(t, 'sine', 120, 45, .1, .45*v); nz(t, .04, 'lowpass', 900, 400, .8, .25*v); },
    ding() { if (!ctx) return; const t = ctx.currentTime; osc(t, 'sine', 2093, 2090, 1.3, .12); osc(t, 'sine', 3136, 3130, .9, .06); osc(t, 'sine', 4180, 4170, .5, .03); nz(t, .2, 'highpass', 2500, 7000, .6, .09); },
    clunk() { if (!ctx) return; const t = ctx.currentTime; osc(t, 'sine', 95, 38, .28, .9); nz(t, .12, 'lowpass', 1200, 200, .9, .5); osc(t, 'triangle', 420, 160, .08, .25); },
    whoosh() { if (!ctx) return; const t = ctx.currentTime; nz(t, .65, 'bandpass', 300, 2800, .7, .0001); const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = .8; f.frequency.setValueAtTime(380, t); f.frequency.exponentialRampToValueAtTime(2600, t+.55); const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.28, t+.22); g.gain.exponentialRampToValueAtTime(.0001, t+.6); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+.65); }
  };
})();

/* ---------- light and tilt ---------- */
let tx = .2, ty = .14, lx = .2, ly = .14, tiltX = 0, tiltY = 0, lastMove = 0, hasOrient = false;
function setLightFromPoint(cx_, cy_) { const r = wrap.getBoundingClientRect(); tx = (cx_ - r.left)/r.width; ty = (cy_ - r.top)/r.height; tx = Math.max(-.45, Math.min(1.45, tx)); ty = Math.max(-.4, Math.min(1.4, ty)); lastMove = performance.now(); }
addEventListener('pointermove', e => { if (hasOrient && e.pointerType === 'touch') return; setLightFromPoint(e.clientX, e.clientY); });
addEventListener('pointerdown', e => setLightFromPoint(e.clientX, e.clientY));
function needOrient() { if (hasOrient || !window.DeviceOrientationEvent) return;
  const go = () => addEventListener('deviceorientation', e => { if (e.gamma == null) return; hasOrient = true; const gx = Math.max(-35, Math.min(35, e.gamma))/35, gy = Math.max(-35, Math.min(35, (e.beta - 50)))/35; tx = .5 + gx*.9; ty = .5 + gy*.9; lastMove = performance.now(); });
  if (typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') go(); }).catch(() => {}); else go(); }

/* ---------- render loop ---------- */
let dpr = Math.min(devicePixelRatio || 1, 2), curRW = 0;
function fit() { const r = wrap.getBoundingClientRect(); const w = Math.max(960, Math.min(W, Math.round(r.width*dpr))); if (w !== curRW) { curRW = w; glc.width = w; glc.height = Math.round(w*H/W); } }
addEventListener('resize', fit);
function render(t) { gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(uLight, lx, ly); const ink = INKS[inkIdx]; gl.uniform3f(uInk, ink[0], ink[1], ink[2]); gl.uniform1f(uTime, (t*.001) % 7); gl.uniform1f(uSeed, seed);
  gl.drawArrays(gl.TRIANGLES, 0, 3); }
const easeOut = x => 1 - Math.pow(1-x, 3);
function pressCurve(t) { if (t < .075) return 1.32*easeOut(t/.075); return 1 + .32*Math.exp(-(t-.075)/.055); }
let frame = 0, forced = true;
function loop(t) {
  requestAnimationFrame(loop); frame++;
  // light spring + idle drift
  const idle = (t - lastMove) > 2500; const dt = idle ? (Math.sin(t*.00045)*.08) : 0; const dy_ = idle ? (Math.cos(t*.0003)*.05) : 0;
  const k = .12; const gxT = idle ? .22 + dt : tx, gyT = idle ? .14 + dy_ : ty;
  lx += (gxT - lx)*k; ly += (gyT - ly)*k;
  const px = (lx - .5), py = (ly - .5);
  sheetEl.style.transform = `rotateY(${(px*7).toFixed(2)}deg) rotateX(${(-py*6).toFixed(2)}deg)`;
  css.setProperty('--lx', (lx*100).toFixed(1) + '%'); css.setProperty('--ly', (ly*80 - 5).toFixed(1) + '%');
  // active glyph layer
  let need = false; const now = performance.now(); let nb = null; const done = [];
  for (const a of active) { const b = box(a.g); nb = union(nb, b); if (a.ghost) nb = union(nb, box(a.ghost.g)); }
  if (prompt) for (const g of prompt.gs) nb = union(nb, box(g, 18));
  if (nb || dirty) {
    const un = union(nb, dirty); const r = clampR(un);
    aX.fillStyle = '#000'; aX.fillRect(r.x, r.y, r.w, r.h);
    for (let i = active.length - 1; i >= 0; i--) { const a = active[i]; const el = (now - a.t0)/1000;
      if (el >= .32) { done.push(a); active.splice(i,1); continue; }
      const p = pressCurve(el); const gh = Math.max(0, 1 - el/.30);
      if (a.ghost) draw(aX, a.ghost.g, 0, 0, false, .85*gh, a.ghost.dx + (a.g.x - a.ghost.g.x), a.ghost.dy + (a.g.y - a.ghost.g.y));
      draw(aX, a.g, p, 1 + .05*Math.min(1.1, p)*(1 - el/.32)); }
    if (prompt) { const e0 = (now - prompt.t0)/1000; let s = 0;
      if (prompt.t1) { const e1 = (now - prompt.t1)/1000; s = Math.max(0, 1 - e1/.9); s = s*s; if (e1 > .9) { prompt = null; } }
      else s = easeOut(Math.min(1, Math.max(0, (e0 - 1.1)/1.1)));
      if (prompt) for (const g of prompt.gs) draw(aX, g, s*.85, 0, false); }
    // commit finished letters to the static layer
    for (const a of done) { if (a.ghost) draw(sX, a.ghost.g, 0, 0, false, .5, a.ghost.dx + (a.g.x - a.ghost.g.x), a.ghost.dy + (a.g.y - a.ghost.g.y)); draw(sX, a.g, 1, 1); }
    // recompute the rect after commit so both layers upload the same area
    let ub = un; for (const a of done) ub = union(ub, box(a.g));
    const r2 = clampR(ub); upload(1, aT, aX, r2);
    if (done.length) { upload(0, sT, sX, r2); }
    dirty = nb; need = true;
  }
  if (forced || need || (frame % 2 === 0)) { fit(); render(t); forced = false; }
}

/* ---------- ink pots, key, export ---------- */
document.querySelectorAll('.pot').forEach(b => b.addEventListener('click', () => { inkIdx = +b.dataset.ink; document.querySelectorAll('.pot').forEach(x => x.setAttribute('aria-pressed', x === b)); A.init(); A.thump(.4); forced = true; focusTa(); }));
const toast = $('toast'); let toastT = 0;
function say(t) { toast.textContent = t; toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 2400); }
const keyEl = $('key');
function exportBlob() { return new Promise(res => { const ow = glc.width, oh = glc.height; glc.width = W; glc.height = H; curRW = W; render(performance.now()); glc.toBlob(b => { res(b); }, 'image/png'); glc.width = ow; glc.height = oh; curRW = ow; forced = true; }); }
async function press() {
  if (busy) return; A.init();
  if (!glyphs.length) { shake(); A.thump(.6); showHint('type something first', true); keyEl.classList.add('down'); setTimeout(() => keyEl.classList.remove('down'), 120); return; }
  busy = true; hintOff(); keyEl.classList.add('down'); A.clunk(); tick();
  await new Promise(r => setTimeout(r, 380)); // let the last letters settle
  const blob = await exportBlob(); const name = `letterpress-${String(sheetNo).padStart(3,'0')}.png`;
  keyEl.classList.remove('down'); A.whoosh();
  await wrap.animate([{transform:'none',opacity:1},{transform:'translateY(-14%) rotate(-1.5deg)',opacity:1,offset:.25},{transform:'translateY(-125%) rotate(-5deg)',opacity:.9}], {duration:700, easing:'cubic-bezier(.55,.05,.75,.35)', fill:'forwards'}).finished;
  // save while the sheet is out of sight
  try { const file = new File([blob], name, {type:'image/png'}); const touch = matchMedia('(pointer:coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({files:[file]})) { await navigator.share({files:[file], title:'Letterpress'}).catch(() => {}); }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say('PRESSED · SAVED'); } } catch (e) { say('PRESSED'); }
  sheetNo++; $('no').textContent = '№ ' + String(sheetNo).padStart(3,'0'); newSheet(); ta.value = ''; forced = true;
  wrap.getAnimations().forEach(a => a.cancel());
  await wrap.animate([{transform:'translateY(115%) rotate(3deg)',opacity:1},{transform:'translateY(-2%) rotate(-.4deg)',offset:.72,opacity:1},{transform:'none',opacity:1}], {duration:900, easing:'cubic-bezier(.2,.8,.2,1)'}).finished;
  busy = false; setTimeout(startPrompt, 250); focusTa();
}
keyEl.addEventListener('click', press);
keyEl.addEventListener('pointerdown', () => { A.init(); });

/* ---------- boot ---------- */
(async () => {
  try { await Promise.all([document.fonts.load('80px Fell'), document.fonts.load('italic 62px Fell'), document.fonts.load('25px FellSC')]); await document.fonts.ready; } catch (e) {}
  newSheet(); fit();
  wrap.animate([{transform:'translateY(60px) rotate(2.4deg) scale(.96)',opacity:0},{transform:'none',opacity:1}], {duration:1100, easing:'cubic-bezier(.2,.8,.2,1)'});
  setTimeout(() => $('bar').classList.add('in'), 450);
  setTimeout(startPrompt, 1000);
  setTimeout(() => { if (!typedOnce) showHint('type · ink doesn’t erase'); }, 2600);
  requestAnimationFrame(loop);
  window.__lp = {stamp, press, get glyphs() { return glyphs.length; }};
})();
})();
