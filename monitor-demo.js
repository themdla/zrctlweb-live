/* Parallax Monitor: live monitor demo for the home page.
   Plays real log footage (Nikon ZR, R3D / Log3G10) and runs the app's looks and exposure tools on it in the browser.
   Interface pieces are cut from real app captures. Tool maths follows the shipped iOS app (2.1):
   thresholds, colours and formulas are documented in 08-rebrand/feature-audit/monitor-tools-spec.md. */
(function () {
  'use strict';
  var root = document.getElementById('mon');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('mon-stage'), pic = $('mon-pic'), glc = $('mon-gl'), video = $('mon-video');
  var bar = $('mon-bar'), strip = $('mon-strip'), marks = $('mon-marks'), toast = $('mon-toast');
  var scopeEl = $('mon-scope'), xlEl = $('mon-xl'), legend = $('mon-legend'), guides = $('mon-guides');
  var wipeEl = $('mon-wipe'), lutPanel = $('mon-luts'), tcEl = $('mon-tc'), recBorder = $('mon-recborder');

  /* ── calibration: R3D / Log3G10 profile, ISO 1600 on the low base (8-bit codes, as in the app) ── */
  var CLIP = 200, HW = CLIP - 15, MID_LO = 82, MID_HI = 88, MC = 85, SW = 40, SC = 25;
  var XZ = [[60, 17, 90], [102, 35, 181], [0, 68, 226], [0, 174, 236], [0, 176, 133], [54, 209, 70], [148, 148, 148],
            [255, 81, 174], [255, 114, 82], [255, 154, 0], [255, 230, 0], [255, 64, 0], [255, 0, 0]];   /* -6 … +6 */
  var XZ_LABELS = ['-6', '-5', '-4', '-3', '-2', '-1', '0', '+1', '+2', '+3', '+4', '+5', '+6'];
  var POST_LUT_CONTRAST = 1.12;   /* the app always applies this after the LUT */

  var LOOKS = [
    { k: 'a', name: 'MEDIUM R2 MEDIUM', src: 'images/demo/live/lut-a-medium.png' },
    { k: 'b', name: 'BW 0300', src: 'images/demo/live/lut-b-bw0300.png' },
    { k: 'c', name: 'FILMBIASOFFSET', src: 'images/demo/live/lut-c-filmbiasoffset.png' },
    { k: 'd', name: 'TECH', src: 'images/demo/live/lut-d-tech.png' }
  ];
  /* toolbar in the app's own order; nine show, the rest scroll in */
  var TOOLS = [
    ['WIPE', 'wipe'], ['SLOW', null, 'Switches the camera to your slow-motion format and back with one tap.'],
    ['ZEBRA', 'zebra'], ['PULL', null, 'Timed focus pulls between up to six autofocus points.'],
    ['MF', null, 'Drives a manual-focus lens between saved In and Out points.'], ['LOCAL', 'punch'],
    ['LVL', null, 'Shows the camera’s level sensor on the picture.'], ['AUD', null, 'Audio meters with peak hold and input gain.'],
    ['CAST', null, 'Shares the live picture with other phones and tablets.'], ['LENS', null, 'Lens profiles for manual lenses, written to the camera.'],
    ['REF', null, 'Ghosts a reference frame over the picture to match a shot.'], ['COMP', 'comp'], ['FRME', 'frme'],
    ['DSQ', null, 'Anamorphic desqueeze from 1.25x to 2x. It needs squeezed footage to show.'], ['SAVE', null, 'Saves your whole layout as a preset.']
  ];
  var VISIBLE = 9, MAXSCROLL = TOOLS.length - VISIBLE;
  /* frame guide and composition guide options, as in the app's own panels */
  var RATIOS = [['16:9', 16 / 9], ['3:2', 1.5], ['1.85', 1.85], ['2.00', 2], ['2.39', 2.39], ['4:3', 4 / 3], ['1:1', 1], ['9:16', 9 / 16], ['4:5', 0.8]];
  var COMPS = ['3rds', '4x4', 'Golden', 'Tri', 'Diag', 'Cross', 'Safe'];
  var SCALES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7], MATTES = [1, 0.75, 0.5, 0.25], OPACITIES = [1, 0.75, 0.5, 0.25];

  var S = { lut: true, look: 'c', panel: null, wipe: false, wipeX: 0.5, peak: false, scope: false, falseC: false,
            zebra: false, expo: false, hud: true, punch: false, rec: false, scroll: 0,
            frames: [], frameMulti: false, frameScale: 1, matte: 0.34, comps: [], compMulti: false, guideOpacity: 1 };
  /* panel: null | 'lut' | 'frme' | 'frme-scale' | 'frme-mask' | 'comp' | 'comp-opacity' */

  /* ── toast inside the picture ── */
  var toastT = null;
  function say(title, text) {
    toast.innerHTML = '';
    var b = document.createElement('b'); b.textContent = title; toast.appendChild(b);
    if (text) toast.appendChild(document.createTextNode(text));
    var cap = $('mon-cap'); if (cap) cap.textContent = text ? text : '';
    toast.classList.add('on'); clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove('on'); }, text ? 3400 : 1300);
  }

  /* ── WebGL picture ── */
  var gl = null, prog = null, U = {}, texVid = null, texLut = {}, lutReady = {}, glOK = false;
  var VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(p, 0.0, 1.0); }';
  var FS = [
    'precision highp float;',
    'varying vec2 v;',
    'uniform sampler2D uVid; uniform sampler2D uLut;',
    'uniform vec2 uTexel;',
    'uniform float uLutOn, uWipe, uFalse, uZebra, uPeak, uContrast;',
    'uniform float uClip, uHw, uMidLo, uMidHi, uMc, uSw, uSc;',
    'uniform vec3 uColors[13];',
    'const vec3 W601 = vec3(0.299, 0.587, 0.114);',
    'const vec3 W709 = vec3(0.2126, 0.7152, 0.0722);',
    'vec3 lut(vec3 c){',
    '  c = clamp(c, 0.0, 1.0);',
    '  float b = c.b * 32.0; float b0 = floor(b); float b1 = min(b0 + 1.0, 32.0); float f = b - b0;',
    '  vec2 uv = vec2((c.r * 32.0 + 0.5) / 33.0, (c.g * 32.0 + 0.5) / 33.0);',
    '  vec3 x0 = texture2D(uLut, vec2((b0 + uv.x) / 33.0, uv.y)).rgb;',
    '  vec3 x1 = texture2D(uLut, vec2((b1 + uv.x) / 33.0, uv.y)).rgb;',
    '  return clamp((mix(x0, x1, f) - 0.5) * uContrast + 0.5, 0.0, 1.0);',
    '}',
    'float l9(vec2 o){ return dot(texture2D(uVid, v + o * uTexel).rgb, W709); }',
    'vec2 sobel(float d){',
    '  float tl = l9(vec2(-d, -d)), tc = l9(vec2(0.0, -d)), tr = l9(vec2(d, -d));',
    '  float ml = l9(vec2(-d, 0.0)), mr = l9(vec2(d, 0.0));',
    '  float bl = l9(vec2(-d, d)), bc = l9(vec2(0.0, d)), br = l9(vec2(d, d));',
    '  return vec2((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr));',
    '}',
    'void main(){',
    '  vec3 src = texture2D(uVid, v).rgb;',                         /* log code values, straight from the footage */
    '  if (uWipe >= 0.0 && v.x < uWipe) { gl_FragColor = vec4(src, 1.0); return; }',   /* wipe: plain log on the left */
    '  float y = dot(src, W601);',                                   /* tools read the signal under the LUT */
    '  vec3 col = uLutOn > 0.5 ? lut(src) : src;',
    '  if (uPeak > 0.5) {',
    '    float fine = length(sobel(1.0));',
    '    float coarse = length(sobel(3.0)) / 3.0;',
    '    float acuity = max(fine - 1.1 * coarse, 0.0);',
    '    float s = clamp((acuity - 0.0339) / 0.0365, 0.0, 1.0);',
    '    col = mix(col, vec3(1.0, 0.196, 0.157), s * s * 0.95);',
    '  }',
    '  if (uFalse > 0.5) {',
    '    float lowerStep = max(0.016, (uMc - uSc) / 6.0);',
    '    float upperStep = max(0.016, (uClip - uMc) / 6.0);',
    '    float stop = y < uMc ? (y - uMc) / lowerStep : (y - uMc) / upperStep;',
    '    float idx = clamp(floor(stop + 6.5), 0.0, 12.0);',
    '    vec3 band = uColors[0];',
    '    for (int i = 1; i < 13; i++) { if (float(i) == idx) band = uColors[i]; }',
    '    float a = idx == 6.0 ? 0.92 : 0.96;',
    '    col = min(vec3(1.0), band + (1.0 - a) * col);',
    '  } else if (uZebra > 0.5) {',
    '    float zx = floor(v.x * 1024.0), zy = floor((1.0 - v.y) * 576.0);',     /* stripes live in feed pixels */
    '    bool sa = mod(floor((zx + zy) / 3.0), 2.0) < 1.0;',
    '    bool sb = mod(floor((zx - zy + 4096.0) / 3.0), 2.0) < 1.0;',
    '    if (y >= uClip && sa) col = mix(col, vec3(1.0, 0.188, 0.188), 0.60);',
    '    else if (y >= uHw && sb) col = mix(col, vec3(1.0, 0.816, 0.0), 0.46);',
    '    else if (y <= uSc && sa) col = mix(col, vec3(1.0, 0.251, 0.627), 0.58);',
    '    else if (y <= uSw && sb) col = mix(col, vec3(0.188, 0.627, 1.0), 0.42);',
    '    else if (y >= uMidLo && y <= uMidHi && sa) col = mix(col, vec3(0.188, 1.0, 0.439), 0.36);',
    '  }',
    '  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',   /* hides banding */
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function initGL() {
    try { gl = glc.getContext('webgl', { antialias: false, alpha: false }); } catch (e) { gl = null; }
    if (!gl) return false;
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn('monitor demo shader', gl.getShaderInfoLog(s)); return null; } return s; }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return false;
    prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uVid', 'uLut', 'uTexel', 'uLutOn', 'uWipe', 'uFalse', 'uZebra', 'uPeak', 'uContrast',
     'uClip', 'uHw', 'uMidLo', 'uMidHi', 'uMc', 'uSw', 'uSc'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    U.uColors = gl.getUniformLocation(prog, 'uColors[0]');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    texVid = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texVid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([70, 74, 76]));
    gl.uniform1i(U.uVid, 0); gl.uniform1i(U.uLut, 1); gl.uniform1f(U.uContrast, POST_LUT_CONTRAST);
    gl.uniform2f(U.uTexel, 1 / 1440, 1 / 810);   /* the app detects peaking on a frame 1440 wide */
    var cols = new Float32Array(39); XZ.forEach(function (c, i) { cols[i * 3] = c[0] / 255; cols[i * 3 + 1] = c[1] / 255; cols[i * 3 + 2] = c[2] / 255; });
    gl.uniform3fv(U.uColors, cols);
    gl.uniform1f(U.uClip, CLIP / 255); gl.uniform1f(U.uHw, HW / 255); gl.uniform1f(U.uMidLo, MID_LO / 255); gl.uniform1f(U.uMidHi, MID_HI / 255);
    gl.uniform1f(U.uMc, MC / 255); gl.uniform1f(U.uSw, SW / 255); gl.uniform1f(U.uSc, SC / 255);
    LOOKS.forEach(function (L) {
      var im = new Image();
      im.onload = function () {
        var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texLut[L.k] = t; lutReady[L.k] = true; if (!running) draw();
      };
      im.src = L.src;
    });
    return true;
  }
  function sizeGL() {
    var r = pic.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.min(1920, Math.max(2, Math.round(r.width * dpr))), h = Math.min(1080, Math.max(2, Math.round(r.height * dpr)));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
  }

  /* ── scope and traffic lights: measured on a 320 x 180 copy of the log frame, like the app ── */
  var AW = 320, AH = 180, ac = document.createElement('canvas'); ac.width = AW; ac.height = AH;
  var actx = ac.getContext('2d', { willReadFrequently: true });
  var WR = 200, wfCanvas = document.createElement('canvas'); wfCanvas.width = AW; wfCanvas.height = WR;
  var wfCtx = wfCanvas.getContext('2d'), wfImg = wfCtx.createImageData(AW, WR), sctx = null, xctx = null;
  function analyse() {
    if (video.readyState < 2) return null;
    try { actx.drawImage(video, 0, 0, AW, AH); return actx.getImageData(0, 0, AW, AH).data; } catch (e) { return null; }
  }
  function drawScope(d) {
    if (!sctx) sctx = scopeEl.getContext('2d');
    var W = scopeEl.width, H = scopeEl.height, bins = new Uint16Array(AW * WR), x, y, i, lv, row, max = 1;
    for (y = 0; y < AH; y++) for (x = 0; x < AW; x++) {
      i = (y * AW + x) * 4; lv = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      row = Math.round(199 - lv / 255 * 199); bins[row * AW + x]++;
    }
    var sm = new Uint16Array(AW * WR), c;
    for (y = 0; y < WR; y++) for (x = 0; x < AW; x++) {
      i = y * AW + x; c = ((4 * bins[i] + bins[y * AW + Math.max(0, x - 1)] + bins[y * AW + Math.min(AW - 1, x + 1)] + 3) / 6) | 0;
      sm[i] = c; if (c > max) max = c;
    }
    var o = wfImg.data, n = AW * WR, t, a;
    for (i = 0; i < n; i++) {
      if (sm[i] > 0) { t = Math.pow(sm[i] / max, 0.42); a = (110 + 145 * t) / 255;
        o[i * 4] = 28 * t; o[i * 4 + 1] = 28 + 210 * t; o[i * 4 + 2] = 8 * t; o[i * 4 + 3] = 255 * a; }
      else { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 0; o[i * 4 + 3] = 0; }
    }
    wfCtx.putImageData(wfImg, 0, 0);
    sctx.clearRect(0, 0, W, H);
    sctx.lineWidth = Math.max(1, W / 520);
    sctx.strokeStyle = 'rgba(255,255,255,.12)'; sctx.beginPath();
    for (i = 1; i < 4; i++) { sctx.moveTo(0, H * i / 4); sctx.lineTo(W, H * i / 4); }
    sctx.stroke(); sctx.strokeStyle = 'rgba(255,255,255,.07)'; sctx.beginPath();
    for (i = 1; i < 4; i++) { sctx.moveTo(W * i / 4, 0); sctx.lineTo(W * i / 4, H); }
    sctx.stroke();
    sctx.globalAlpha = 0.9; sctx.imageSmoothingEnabled = true; sctx.drawImage(wfCanvas, 0, 0, W, H); sctx.globalAlpha = 1;
    var lines = [['C', CLIP, '255,69,58', 0.85], ['H', HW, '255,214,10', 0.85], ['M', MC, '48,209,88', 0.80], ['', SW, '255,159,10', 0.65], ['S', SC, '255,69,58', 0.55]];
    sctx.textBaseline = 'middle';
    lines.forEach(function (l) {
      var yy = (H - 1) - l[1] / 255 * (H - 1);
      sctx.strokeStyle = 'rgba(' + l[2] + ',' + l[3] + ')'; sctx.lineWidth = Math.max(1.4, W / 300); sctx.setLineDash([W / 50, W / 50]);
      sctx.beginPath(); sctx.moveTo(0, yy); sctx.lineTo(W, yy); sctx.stroke(); sctx.setLineDash([]);
      if (l[0]) {
        sctx.fillStyle = 'rgb(' + l[2] + ')'; sctx.textAlign = 'center';
        sctx.font = '700 ' + Math.round(W * 0.05) + 'px JetBrains Mono, monospace'; sctx.fillText(l[0], W * 0.05, yy);
        sctx.globalAlpha = 0.9; sctx.font = '700 ' + Math.round(W * 0.04) + 'px JetBrains Mono, monospace'; sctx.fillText(String(l[1]), W * 0.89, yy); sctx.globalAlpha = 1;
      }
    });
  }
  function hiW(code) { return code <= 97 ? 0 : code < HW ? 0.30 * (code - 97) / (HW - 97) : code < CLIP ? 0.30 + 0.70 * (code - HW) / (CLIP - HW) : 1; }
  function shW(code) { return code >= 73 ? 0 : code > SW ? 0.30 * (73 - code) / (73 - SW) : code > SC ? 0.30 + 0.70 * (SW - code) / (SW - SC) : 1; }
  var HIW = [], SHW = []; (function () { for (var i = 0; i < 256; i++) { HIW[i] = hiW(i); SHW[i] = shW(i); } })();
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function drawLights(d) {
    if (!xctx) xctx = xlEl.getContext('2d');
    var W = xlEl.width, H = xlEl.height, n = AW * AH, i, c, v, lv;
    var hp = [0, 0, 0], sp = [0, 0, 0], clipN = 0, crushN = 0;
    for (i = 0; i < n; i++) {
      for (c = 0; c < 3; c++) { v = d[i * 4 + c]; hp[c] += HIW[v]; sp[c] += SHW[v]; }
      lv = ((d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000) | 0;
      if (lv >= CLIP) clipN++; if (lv <= SC) crushN++;
    }
    for (c = 0; c < 3; c++) { hp[c] = 100 * hp[c] / n; sp[c] = 100 * sp[c] / n; }
    var noiseP = Math.max(100 * crushN / n, (sp[0] + sp[1] + sp[2]) / 3), clipP = Math.max(100 * clipN / n, (hp[0] + hp[1] + hp[2]) / 3);
    xctx.clearRect(0, 0, W, H);
    /* drawn on a 570 x 470 grid measured from the app's own panel */
    var k = W / 570, cols = [[255, 52, 56], [99, 232, 69], [47, 115, 255]], xs = [60, 143, 226];
    var top = 84, bot = 392, mid = (top + bot) / 2, gapC = 6, segH = (bot - top - gapC * 2) / 18;
    function lamp(x, yy, pressure, col) {
      var sev = Math.max(0, Math.min(1, pressure / 25)), lit = sev >= 0.04;
      xctx.beginPath(); xctx.arc(x * k, yy * k, 16 * k, 0, 6.2832);
      xctx.fillStyle = lit ? 'rgba(' + col.join(',') + ',' + (0.18 + 0.82 * sev) + ')' : 'rgba(0,0,0,.30)'; xctx.fill();
      xctx.lineWidth = 3 * k; xctx.strokeStyle = lit ? 'rgba(' + col.join(',') + ',.85)' : 'rgba(255,255,255,.22)'; xctx.stroke();
    }
    function count(pressure, segs) { var sev = Math.max(0, Math.min(1, pressure / 25)); return sev <= 0.025 ? 0 : Math.ceil(sev * segs); }
    for (c = 0; c < 3; c++) {
      var col = cols[c], cx = xs[c], up = count(hp[c], 9), dn = count(sp[c], 9);
      lamp(cx, 45, hp[c], col); lamp(cx, 425, sp[c], col);
      rr(xctx, (cx - 24) * k, (top - 8) * k, 48 * k, (bot - top + 16) * k, 24 * k); xctx.fillStyle = 'rgba(0,0,0,.34)'; xctx.fill();
      xctx.lineWidth = 2 * k; xctx.strokeStyle = 'rgba(255,255,255,.28)'; xctx.stroke();
      for (i = 0; i < 9; i++) {
        xctx.fillStyle = 'rgba(' + col.join(',') + ',' + (i < up ? 0.96 : 0.15) + ')'; rr(xctx, (cx - 16) * k, (mid - gapC - (i + 1) * segH + 2) * k, 32 * k, (segH - 4) * k, 3 * k); xctx.fill();
        xctx.fillStyle = 'rgba(' + col.join(',') + ',' + (i < dn ? 0.96 : 0.15) + ')'; rr(xctx, (cx - 16) * k, (mid + gapC + i * segH + 2) * k, 32 * k, (segH - 4) * k, 3 * k); xctx.fill();
      }
      xctx.fillStyle = 'rgba(255,255,255,.78)'; xctx.fillRect((cx - 27) * k, (mid - 2.4) * k, 54 * k, 4.8 * k);
    }
    xctx.fillStyle = 'rgba(255,255,255,.18)'; xctx.fillRect(291 * k, 106 * k, 2.5 * k, 258 * k);
    var meters = [['NOISE', noiseP, [255, 159, 24], 382], ['CLIP', clipP, [255, 52, 56], 497]], mt = 38, mb = 392, ms = (mb - mt) / 16;
    xctx.font = '800 ' + Math.round(27 * k) + 'px JetBrains Mono, monospace'; xctx.textAlign = 'center'; xctx.textBaseline = 'middle';
    meters.forEach(function (m) {
      var cx = m[3], col = m[2], sev = m[1] <= 0.001 ? 0 : Math.pow(Math.min(1, m[1] / 25), 0.52), litN = sev <= 0.025 ? 0 : Math.ceil(sev * 16);
      rr(xctx, (cx - 26) * k, (mt - 8) * k, 52 * k, (mb - mt + 16) * k, 16 * k); xctx.fillStyle = 'rgba(0,0,0,.34)'; xctx.fill();
      xctx.lineWidth = 2 * k; xctx.strokeStyle = 'rgba(255,255,255,.28)'; xctx.stroke();
      for (i = 0; i < 16; i++) { xctx.fillStyle = 'rgba(' + col.join(',') + ',' + (i < litN ? 0.96 : 0.15) + ')'; rr(xctx, (cx - 17) * k, (mb - (i + 1) * ms + 2) * k, 34 * k, (ms - 4) * k, 3 * k); xctx.fill(); }
      xctx.fillStyle = m[1] > 0.05 ? 'rgb(' + col.join(',') + ')' : 'rgba(255,255,255,.38)'; xctx.fillText(m[0], cx * k, 438 * k);
    });
  }

  /* ── render loop ── */
  var running = false, frameNo = 0, recStart = 0;
  function draw() {
    if (!glOK) return;
    sizeGL(); gl.viewport(0, 0, glc.width, glc.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texVid);
    if (video.readyState >= 2) { try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); } catch (e) {} }
    var lk = lutReady[S.look] ? S.look : null;
    gl.activeTexture(gl.TEXTURE1); if (lk) gl.bindTexture(gl.TEXTURE_2D, texLut[lk]);
    gl.uniform1f(U.uLutOn, S.lut && lk ? 1 : 0); gl.uniform1f(U.uWipe, S.wipe ? S.wipeX : -1);
    gl.uniform1f(U.uFalse, S.falseC ? 1 : 0); gl.uniform1f(U.uZebra, S.zebra ? 1 : 0); gl.uniform1f(U.uPeak, S.peak ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (S.hud && (S.scope || S.expo) && (frameNo++ % 4 === 0)) { var d = analyse(); if (d) { if (S.scope) drawScope(d); if (S.expo) drawLights(d); } }
    if (S.rec) {
      var el = (performance.now() - recStart) / 1000, f = Math.floor((el % 1) * 24), s = Math.floor(el) % 60, m = Math.floor(el / 60) % 60;
      var p2 = function (q) { return (q < 10 ? '0' : '') + q; }, txt = '00:' + p2(m) + ':' + p2(s) + ':' + p2(f);
      if (tcEl.lastChild.textContent !== txt) tcEl.lastChild.textContent = txt;
    }
  }
  function loop() { if (!running) return; draw(); requestAnimationFrame(loop); }   /* keeps redrawing while visible, even if the video stalls */
  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function start() {
    if (running) return; running = true;
    if (still) { video.preload = 'auto'; if (video.readyState < 2) video.load(); }   /* reduced motion: tools work on a still frame */
    else { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    loop();
  }
  function stop() { running = false; try { video.pause(); } catch (e) {} }

  /* ── overlays that are plain DOM ── */
  function buildLegend() {
    var h = '<b>X-ZONE</b>';
    for (var i = 12; i >= 0; i--) h += '<span><i style="background:rgb(' + XZ[i].join(',') + ')"></i>' + XZ_LABELS[i] + '</span>';
    legend.innerHTML = h;
  }
  var choice = $('mon-choice');
  function pct(v) { return Math.round(v * 100) + '%'; }
  function has(arr, v) { return arr.indexOf(v) !== -1; }
  function toggleIn(arr, v, multi) {
    if (multi) { var i = arr.indexOf(v); if (i === -1) arr.push(v); else arr.splice(i, 1); return arr; }
    return has(arr, v) && arr.length === 1 ? [] : [v];
  }
  /* one tile = [label, selected, action, wide?] ; laid out four across like the app */
  function tiles(list, cls) {
    choice.className = 'mon-choice' + (cls ? ' ' + cls : ''); choice.innerHTML = '';
    list.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; if (t[1]) b.className = 'sel';
      b.innerHTML = '<span></span><i>✓</i>'; b.firstChild.textContent = t[0];
      b.addEventListener('click', function (e) { e.stopPropagation(); t[2](); render(); });
      choice.appendChild(b);
    });
  }
  function buildPanel() {
    lutPanel.hidden = S.panel !== 'lut'; choice.hidden = !S.panel || S.panel === 'lut';
    if (S.panel === 'lut') {
      lutPanel.innerHTML = '';
      LOOKS.forEach(function (L) {
        var b = document.createElement('button'); b.type = 'button'; if (S.lut && L.k === S.look) b.className = 'sel';
        b.innerHTML = '<em>' + L.k.toUpperCase() + '</em><span>' + L.name + '</span><i>✓</i>';
        b.addEventListener('click', function (e) { e.stopPropagation(); S.look = L.k; S.lut = true; render(); });
        lutPanel.appendChild(b);
      });
    } else if (S.panel === 'frme') {
      var t = RATIOS.map(function (r) { return [r[0], has(S.frames, r[0]), function () { S.frames = toggleIn(S.frames, r[0], S.frameMulti); }]; });
      t.push([S.frameMulti ? 'Multi On' : 'Multi Off', S.frameMulti, function () { S.frameMulti = !S.frameMulti; if (!S.frameMulti && S.frames.length > 1) S.frames = [S.frames[0]]; }]);
      t.push(['Custom', false, function () { say('CUSTOM', 'Type any ratio you like. Not part of this demo.'); }]);
      t.push(['Scale', S.frameScale < 0.999, function () { S.panel = 'frme-scale'; }]);
      t.push(['Mask', S.matte > 0.001, function () { S.panel = 'frme-mask'; }]);
      t.push(['Fill', false, function () { say('FILL', 'Fills the whole screen with the picture. Not part of this demo.'); }]);
      tiles(t);
    } else if (S.panel === 'frme-scale') {
      tiles(SCALES.map(function (v) { return [pct(v), Math.abs(S.frameScale - v) < 0.001, function () { S.frameScale = v; S.panel = 'frme'; say('SCALE ' + pct(v), ''); }]; }));
    } else if (S.panel === 'frme-mask') {
      tiles(MATTES.map(function (v) { return [pct(v), Math.abs(S.matte - v) < 0.001, function () { S.matte = v; S.panel = 'frme'; say('MASK ' + pct(v), ''); }]; }));
    } else if (S.panel === 'comp') {
      var c = COMPS.map(function (g) { return [g, has(S.comps, g), function () { S.comps = toggleIn(S.comps, g, S.compMulti); }]; });
      c.push(['Multi', S.compMulti, function () { S.compMulti = !S.compMulti; if (!S.compMulti && S.comps.length > 1) S.comps = [S.comps[0]]; }]);
      c.push(['Opacity ' + pct(S.guideOpacity), S.guideOpacity < 0.999, function () { S.panel = 'comp-opacity'; }]);
      tiles(c);
    } else if (S.panel === 'comp-opacity') {
      tiles(OPACITIES.map(function (v) { return [pct(v), Math.abs(S.guideOpacity - v) < 0.001, function () { S.guideOpacity = v; S.panel = 'comp'; say('OPACITY ' + pct(v), ''); }]; }));
    }
  }
  /* guides are drawn on a 1600 x 900 SVG stretched over the picture, with the app's line weights and opacities */
  function drawGuides() {
    var VW = 1600, VH = 900, A = 16 / 9, o = S.guideOpacity, h = '', inner = null, sel = RATIOS.filter(function (r) { return has(S.frames, r[0]); });
    function rect(r) {
      var w = r >= A ? VW : VH * r, hh = r >= A ? VW / r : VH; w *= S.frameScale; hh *= S.frameScale;
      return { x: (VW - w) / 2, y: (VH - hh) / 2, w: w, h: hh };
    }
    var L = function (x1, y1, x2, y2, st) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" ' + st + '/>'; };
    if (sel.length === 1) {
      var q = rect(sel[0][1]); inner = q;
      if (S.matte > 0.001) h += '<path fill-rule="evenodd" fill="rgba(0,0,0,' + S.matte + ')" d="M0 0H' + VW + 'V' + VH + 'H0Z M' + q.x + ' ' + q.y + 'h' + q.w + 'v' + q.h + 'h' + (-q.w) + 'Z"/>';
      h += '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" fill="none" stroke="rgba(255,255,255,' + (0.45 * o) + ')" stroke-width="1.6"/>';
    } else sel.forEach(function (r) {
      var q = rect(r[1]);
      h += '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" fill="none" stroke="rgba(255,255,255,' + (0.62 * o) + ')" stroke-width="1.3" stroke-dasharray="7 5"/>';
    });
    if (S.comps.length) {
      var q2 = inner || { x: 0, y: 0, w: VW, h: VH }, X = function (f) { return q2.x + q2.w * f; }, Y = function (f) { return q2.y + q2.h * f; };
      var white = function (a, w, d) { return 'stroke="rgba(255,255,255,' + (a * o) + ')" stroke-width="' + w + '"' + (d ? ' stroke-dasharray="' + d + '"' : ''); };
      var gold = function (a, w) { return 'stroke="rgba(245,230,158,' + (a * o) + ')" stroke-width="' + w + '"'; };
      S.comps.forEach(function (g) {
        var i, f;
        if (g === '3rds') for (i = 1; i < 3; i++) { h += L(X(i / 3), Y(0), X(i / 3), Y(1), white(0.52, 1.3)) + L(X(0), Y(i / 3), X(1), Y(i / 3), white(0.52, 1.3)); }
        if (g === '4x4') for (i = 1; i < 4; i++) { h += L(X(i / 4), Y(0), X(i / 4), Y(1), white(0.52, 1.3)) + L(X(0), Y(i / 4), X(1), Y(i / 4), white(0.52, 1.3)); }
        if (g === 'Golden') [0.382, 0.618].forEach(function (f2) { h += L(X(f2), Y(0), X(f2), Y(1), gold(0.62, 1.3)) + L(X(0), Y(f2), X(1), Y(f2), gold(0.62, 1.3)); });
        if (g === 'Tri') {
          var dx = q2.w, dy = -q2.h, t = (q2.h * q2.h) / (dx * dx + dy * dy);           /* foot of the perpendicular from the top-left corner */
          h += L(X(0), Y(1), X(1), Y(0), gold(0.54, 1.25)) + L(X(0), Y(0), X(0) + dx * t, Y(1) + dy * t, gold(0.38, 1.1)) + L(X(1), Y(1), X(1) - dx * t, Y(0) - dy * t, gold(0.38, 1.1));
        }
        if (g === 'Diag') h += L(X(0), Y(0), X(1), Y(1), white(0.42, 1.15, '6 5')) + L(X(0), Y(1), X(1), Y(0), white(0.42, 1.15, '6 5'));
        if (g === 'Cross') h += L(X(0.5) - 64, Y(0.5), X(0.5) + 64, Y(0.5), white(0.65, 1.4)) + L(X(0.5), Y(0.5) - 64, X(0.5), Y(0.5) + 64, white(0.65, 1.4));
        if (g === 'Safe') [[0.035, '4 4'], [0.05, '2 4']].forEach(function (sf) { f = sf[0];
          h += '<rect x="' + X(f) + '" y="' + Y(f) + '" width="' + q2.w * (1 - 2 * f) + '" height="' + q2.h * (1 - 2 * f) + '" fill="none" ' + white(0.42, 1.2, sf[1]) + '/>'; });
      });
    }
    guides.innerHTML = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="none">' + h + '</svg>';
  }

  /* ── state to screen ── */
  var rails = {};
  function render() {
    root.classList.toggle('hud-off', !S.hud); root.classList.toggle('punch', S.punch); root.classList.toggle('rec', S.rec); root.classList.toggle('fc', S.falseC);
    scopeEl.hidden = !S.scope; xlEl.hidden = !S.expo; legend.hidden = !S.falseC; wipeEl.hidden = !S.wipe; recBorder.hidden = !S.rec; buildPanel();
    wipeEl.style.left = (S.wipeX * 100) + '%';
    var on = { lut: S.lut, peak: S.peak, scope: S.scope, falseC: S.falseC, expo: S.expo, hud: !S.hud, rec: S.rec };
    Object.keys(rails).forEach(function (k) { rails[k].classList.toggle('on', !!on[k]); rails[k].classList.toggle('dim', k === 'lut' && !S.lut); });
    var tb = { wipe: S.wipe, zebra: S.zebra, punch: S.punch, comp: S.comps.length > 0, frme: S.frames.length > 0 };
    [].forEach.call(marks.children, function (m) { m.classList.toggle('on', !!tb[m.getAttribute('data-a')]); });
    strip.style.transform = marks.style.transform = 'translateX(' + (-S.scroll * 100 / TOOLS.length) + '%)';
    root.classList.toggle('at-start', S.scroll <= 0.01); root.classList.toggle('at-end', S.scroll >= MAXSCROLL - 0.01);
    [].forEach.call(document.querySelectorAll('.mon-pills button'), function (b) {
      var k = b.getAttribute('data-p'), v = k === 'log' ? !S.lut : k === 'looks' ? S.panel === 'lut' : k === 'guides' ? S.frames.length > 0 : (on[k] !== undefined ? on[k] : tb[k]);
      b.setAttribute('aria-pressed', String(!!v));
    });
    tcEl.classList.toggle('rec', S.rec);
    tcEl.firstChild.textContent = S.rec ? '● REC' : 'STBY';
    if (!S.rec) tcEl.lastChild.textContent = '--:--:--:--';
    drawGuides(); if (!running) draw();
  }

  /* ── the tools, with the app's own exclusivity rules ── */
  function act(a, label, info) {
    switch (a) {
      case 'lut': S.panel = S.panel === 'lut' ? null : 'lut'; break;
      case 'log': S.lut = !S.lut; if (!S.lut) S.wipe = false; say(S.lut ? 'LUT ON' : 'LUT OFF', S.lut ? '' : 'The flat log picture the camera records.'); break;
      case 'peak': S.peak = !S.peak; if (S.peak) S.falseC = false; say('PEAK ' + (S.peak ? 'ON' : 'OFF'), S.peak ? 'Edges that are truly sharp light up red.' : ''); break;
      case 'scope': S.scope = !S.scope; if (S.scope) S.hud = true; say('SCOPE ' + (S.scope ? 'ON' : 'OFF'), S.scope ? 'A live waveform of the log signal. Drag it anywhere.' : ''); break;
      case 'falseC': S.falseC = !S.falseC; if (S.falseC) { S.peak = false; S.zebra = false; } say('FALSE ' + (S.falseC ? 'ON' : 'OFF'), S.falseC ? 'Thirteen exposure zones around middle gray.' : ''); break;
      case 'expo': S.expo = !S.expo; if (S.expo) S.hud = true; say('EXPO ' + (S.expo ? 'ON' : 'OFF'), S.expo ? 'Traffic lights for red, green and blue, with noise and clip meters.' : ''); break;
      case 'hud': S.hud = !S.hud; S.panel = null; if (!S.hud) say('HUD OFF', 'A clean picture. Tap HUD to bring the tools back.'); break;
      case 'rec': S.rec = !S.rec; if (S.rec) recStart = performance.now(); say(S.rec ? 'REC' : 'STBY', S.rec ? 'On a camera this rolls and cuts. Here it only shows the record state.' : ''); break;
      case 'wipe': S.wipe = !S.wipe; if (S.wipe) { S.lut = true; S.wipeX = 0.5; } say('WIPE ' + (S.wipe ? 'ON' : 'OFF'), S.wipe ? 'Drag the line. Log on the left, your look on the right.' : ''); break;
      case 'zebra': S.zebra = !S.zebra; if (S.zebra) S.falseC = false; say('ZEBRA ' + (S.zebra ? 'ON' : 'OFF'), S.zebra ? 'Stripes on clipping, crushed shadows and middle gray.' : ''); break;
      case 'punch': S.punch = !S.punch; say(S.punch ? 'LOCAL 2x' : 'LOCAL OFF', S.punch ? 'Punched in on the monitor to check focus.' : ''); break;
      case 'comp': if (S.panel === 'comp' || S.panel === 'comp-opacity') S.panel = null; else { S.panel = 'comp'; S.hud = true; if (!S.comps.length) S.comps = ['3rds']; } break;
      case 'frme': if (S.panel && S.panel.indexOf('frme') === 0) S.panel = null; else { S.panel = 'frme'; S.hud = true; if (!S.frames.length) S.frames = ['2.39']; } break;
      case 'reset': S.lut = true; S.look = 'c'; S.panel = null; S.wipe = S.peak = S.scope = S.falseC = S.zebra = S.expo = S.punch = S.rec = false; S.hud = true; S.scroll = 0;
        S.frames = []; S.comps = []; S.frameMulti = S.compMulti = false; S.frameScale = 1; S.matte = 0.34; S.guideOpacity = 1;
        scopeEl.style.left = scopeEl.style.top = scopeEl.style.bottom = ''; say('RESET', ''); break;
      default: say(label, (info || '') + ' Not part of this demo.');
    }
    render();
  }

  /* rail buttons sit over the real icons (percent of the phone frame) */
  [['lut', 'LUT', 6.3, 15.1], ['peak', 'PEAK', 6.3, 27.2], ['scope', 'SCOPE', 6.3, 72.2], ['falseC', 'FALSE', 6.3, 84.0],
   ['hud', 'HUD', 93.6, 22.8], [null, 'AF', 93.6, 34.4, 'Touch autofocus: tap the picture to set the focus point.'],
   ['rec', 'REC', 93.6, 50.0], ['expo', 'EXPO', 93.6, 72.2],
   [null, 'LOCK', 93.6, 83.3, 'Locks the screen rotation.']].forEach(function (r) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'mon-rail' + (r[1] === 'REC' ? ' rec' : ''); b.style.left = r[2] + '%'; b.style.top = r[3] + '%';
    b.setAttribute('aria-label', r[1]);
    b.addEventListener('click', function (e) { e.stopPropagation(); act(r[0], r[1], r[4]); });
    stage.appendChild(b); if (r[0]) rails[r[0]] = b;
  });
  TOOLS.forEach(function (t, i) { var m = document.createElement('i'); m.style.left = ((i + 0.5) / TOOLS.length * 100) + '%'; m.setAttribute('data-a', t[1] || ''); marks.appendChild(m); });

  /* toolbar: tap a tool, or drag sideways to scroll like the app */
  var drag = null;
  function cellW() { return bar.getBoundingClientRect().width / VISIBLE; }
  bar.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, s: S.scroll, moved: false }; try { bar.setPointerCapture(e.pointerId); } catch (x) {} });
  bar.addEventListener('pointermove', function (e) {
    if (!drag) return; var dx = e.clientX - drag.x; if (Math.abs(dx) > 10) drag.moved = true;
    if (drag.moved) { S.scroll = Math.max(0, Math.min(MAXSCROLL, drag.s - dx / cellW())); render(); }
  });
  bar.addEventListener('pointerup', function (e) {
    if (!drag) return; var d = drag; drag = null;
    if (d.moved) { S.scroll = Math.round(S.scroll); render(); return; }
    var r = bar.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / cellW() + S.scroll);
    if (i >= 0 && i < TOOLS.length) act(TOOLS[i][1], TOOLS[i][0], TOOLS[i][2]);
  });
  bar.addEventListener('pointercancel', function () { drag = null; });
  bar.addEventListener('click', function (e) { e.stopPropagation(); });
  /* A sideways swipe flips to the other page of tools. Small stray movements (a Magic Mouse or trackpad brushes
     sideways all the time) are ignored, and momentum after a swipe is swallowed. */
  var wAcc = 0, wLock = 0, wT = null;
  bar.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
    e.preventDefault();
    var now = performance.now(); if (now < wLock) return;
    wAcc += e.deltaX; clearTimeout(wT); wT = setTimeout(function () { wAcc = 0; }, 160);
    if (Math.abs(wAcc) > 90) { S.scroll = wAcc > 0 ? MAXSCROLL : 0; wAcc = 0; wLock = now + 900; render(); }
  }, { passive: false });
  $('mon-next').addEventListener('click', function (e) { e.stopPropagation(); S.scroll = MAXSCROLL; render(); });
  $('mon-prev').addEventListener('click', function (e) { e.stopPropagation(); S.scroll = 0; render(); });
  $('mon-menu').addEventListener('click', function (e) { e.stopPropagation(); act(null, 'MENU', 'Opens the other pages: Controls, Playback, Multicam and more.'); });

  /* draggable wipe line and scope */
  function dragger(el, onMove) {
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (x) {}
      var r = pic.getBoundingClientRect(), er = el.getBoundingClientRect(), ox = e.clientX - er.left, oy = e.clientY - er.top;
      function mv(ev) { onMove((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, ox / r.width, oy / r.height, er.width / r.width, er.height / r.height); }
      function up() { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); }
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  dragger(wipeEl, function (x) { S.wipeX = Math.max(0, Math.min(1, x)); wipeEl.style.left = (S.wipeX * 100) + '%'; if (!running) draw(); });
  dragger(scopeEl, function (x, y, ox, oy, w, h) {
    scopeEl.style.left = (Math.max(0, Math.min(1 - w, x - ox)) * 100) + '%'; scopeEl.style.top = (Math.max(0, Math.min(1 - h, y - oy)) * 100) + '%'; scopeEl.style.bottom = 'auto';
  });
  pic.addEventListener('click', function () { if (S.panel) { S.panel = null; render(); } });
  [].forEach.call(document.querySelectorAll('.mon-pills button'), function (b) {
    b.addEventListener('click', function () { var k = b.getAttribute('data-p'); act(k === 'looks' ? 'lut' : k === 'guides' ? 'frme' : k, k); });
  });

  /* ── go ── */
  buildLegend();
  (function () {
    var r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, conn = navigator.connection || {};
    var small = r.width * dpr < 1000 || conn.saveData;
    video.src = small ? video.getAttribute('data-src-720') : video.getAttribute('data-src-1080');
  })();
  glOK = initGL();
  if (!glOK) { root.classList.add('no-gl'); return; }
  root.classList.add('ready');
  video.addEventListener('loadeddata', function () { if (still && video.currentTime < 0.5) { try { video.currentTime = 1.2; } catch (e) {} } draw(); });
  window.addEventListener('resize', function () { if (!running) draw(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) start(); else stop(); }); }, { threshold: 0.15 }).observe(stage);
  } else start();
  render();
  window.__mon = { S: S, act: act, render: render };
})();
