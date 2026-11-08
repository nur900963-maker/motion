import { XMLParser } from 'fast-xml-parser';
import type { EffectParam, Keyframe, Layer, LayerEffect, LayerType, MediaDecl, Scene } from './types';

export type { Keyframe, Layer, LayerType, Scene } from './types';

/**
 * Parser XML Alight Motion ("Export Project Package (XML)").
 *
 * Struktur yang dibaca dibangun dari file ekspor Alight Motion asli (bukan dari dokumentasi
 * resmi — formatnya tidak dipublikasikan):
 *
 *   <scene title width height fps totalTime bgcolor ...>
 *     <bookmark t="ms"/>
 *     <media uri="am:..." filename title type width height duration .../>   ← deklarasi media
 *     <shape|video|image|audio|text|group|nullobj|embedScene ... startTime endTime ...>
 *       <transform><location|scale|rotation|opacity> (value="..." atau <kf t v e/>) </transform>
 *       <property name="size" type="vec2" value="w,h"/> · <fillColor value/> · <gradient .../>
 *       <path-stroke><color/><size/></path-stroke> · <shadow><color/><size/><hardness/><offset/></shadow>
 *       <effect id="com.alightcreative.effects.*"><property name type value|<kf>/></effect>
 *       <embedScene><scene ...> ...layer anak... </scene></embedScene>
 *     </...>
 *   </scene>
 *
 * Hal yang terbukti dari data:
 *  - `t` pada <kf> adalah FRAKSI durasi layer (0 = startTime, 1 = endTime), boleh di luar 0..1,
 *    dan urutannya di file tidak berurutan → di sini dikonversi ke ms dan diurutkan.
 *  - `e="cubicBezier x1 y1 x2 y2"` berlaku untuk segmen yang MASUK ke keyframe itu.
 *  - `e="elastic ..."` / `e="reverse elastic ..."` = kurva pegas AM (diapproximasi model pegas).
 *  - Media dirujuk lewat fillImage / fillVideo / fillAudio; URI Android (content://) tidak bisa
 *    dibuka di web — pengguna memasang media sendiri ke slot; URI "am:..." dicocokkan ke <media>.
 *
 * Parser TIDAK mengarang nilai: yang tidak dikenali dicatat di `warnings`.
 */

export class XmlError extends Error {}

/** Pohon elemen sederhana yang mempertahankan urutan dokumen. */
type El = { tag: string; attrs: Record<string, string>; children: El[] };

const LAYER_TAGS: Record<string, LayerType> = {
  shape: 'shape',
  video: 'video',
  image: 'image',
  audio: 'audio',
  text: 'text',
  textshape: 'text',
  group: 'group',
  embed: 'scene',
  embedScene: 'scene',
  scene: 'scene',
  precomp: 'scene',
  camera: 'other',
  null: 'other',
  nullobj: 'other',
};
const CONTAINER_TAGS = new Set(['group', 'embed', 'embedScene', 'scene', 'precomp']);

const BLEND_MAP: Record<string, string> = {
  normal: 'source-over',
  'linear-dodge': 'lighter',
  add: 'lighter',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** Nama blend Alight Motion → globalCompositeOperation canvas (default source-over). */
export function blendToComposite(blending: string | undefined): GlobalCompositeOperation {
  return ((blending && BLEND_MAP[blending.toLowerCase()]) || 'source-over') as GlobalCompositeOperation;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function nums(v: unknown): number[] {
  if (typeof v !== 'string') return [];
  return v
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
}

const attr = (el: El | undefined, name: string): string | undefined => {
  const v = el?.attrs[name];
  return v === undefined || v.trim() === '' ? undefined : v;
};
const kids = (el: El | undefined, name: string): El[] => (el ? el.children.filter((c) => c.tag === name) : []);

/** Decode referensi karakter numerik (&#120293; / &#x1D5E5;) yang tidak diurus parser. */
function decodeNumericEntities(v: string): string {
  return v.replace(/&#(x[0-9a-f]+|\d+);/gi, (m, code: string) => {
    const n = code[0] === 'x' || code[0] === 'X' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/** Ubah keluaran preserveOrder fast-xml-parser menjadi pohon El. */
function toTree(items: unknown): El[] {
  if (!Array.isArray(items)) return [];
  const out: El[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const tag = Object.keys(rec).find((k) => k !== ':@' && k !== '#text');
    if (!tag) continue;
    const attrs: Record<string, string> = {};
    const raw = rec[':@'];
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        attrs[k.replace(/^@_/, '')] = decodeNumericEntities(String(v));
      }
    }
    out.push({ tag, attrs, children: toTree(rec[tag]) });
  }
  return out;
}

/** "#aarrggbb" (format Alight Motion) atau "#rrggbb" → css rgba()/hex. */
export function argbToCss(value: string | undefined, fallback = '#888888'): string {
  if (!value) return fallback;
  const v = value.trim();
  const m = /^#?([0-9a-f]{8})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    const a = ((n >>> 24) & 255) / 255;
    return `rgba(${(n >>> 16) & 255},${(n >>> 8) & 255},${n & 255},${a.toFixed(3)})`;
  }
  return /^#?[0-9a-f]{6}$/i.test(v) ? `#${v.replace('#', '')}` : fallback;
}

/* ───────────── easing ───────────── */

export type EasingParse = {
  bezier?: [number, number, number, number];
  name?: string;
  params?: number[];
};

/** Nama easing khusus yang dikenali (selain cubicBezier). */
export const KNOWN_EASINGS = new Set([
  'linear',
  'hold',
  'step',
  'elastic',
  'reverse elastic',
  'bounce',
  'overshoot',
  'anticipate',
]);

export function parseEasing(e: string | undefined, unknown: Set<string>): EasingParse {
  if (!e) return {};
  const s = e.trim();
  const m = /^cubicBezier\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/i.exec(s);
  if (m) {
    const q = [m[1], m[2], m[3], m[4]].map(Number);
    if (q.every((x) => Number.isFinite(x))) return { bezier: q as [number, number, number, number] };
  }
  // Nama khusus: "elastic a b c d", "reverse elastic a b c d", dst.
  const tokens = s.split(/\s+/);
  for (const name of ['reverse elastic', 'elastic', 'bounce', 'overshoot', 'anticipate', 'hold', 'step', 'linear']) {
    if (s.toLowerCase() === name || s.toLowerCase().startsWith(name + ' ')) {
      if (name === 'linear') return {};
      const params = tokens.slice(name.split(' ').length).map(Number).filter((x) => Number.isFinite(x));
      return { name, params };
    }
  }
  unknown.add(tokens[0]);
  return {};
}

/** Pegas teredam gaya AM: `reverse elastic` = overshoot saat datang, `elastic` = antisipasi. */
export function elasticEase(t: number, reverse: boolean, p: number[]): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cycles = 2.2 + 5 * Math.min(1, Math.max(0, p[0] ?? 0.4));
  const damp = 5 + 6 * Math.min(1.5, Math.max(0, p[1] ?? 1));
  const w = 2 * Math.PI * cycles;
  const out = 1 - Math.pow(2, -damp * t) * Math.cos(w * t);
  return reverse ? out : 1 - out;
}

/** Bounce gaya Penner. */
export function bounceEase(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** Overshoot (back-out) & anticipate (back-in) gaya Penner. */
export function backEase(t: number, out: boolean): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const f = (x: number) => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  return out ? f(t) : 1 - f(1 - t);
}

/** Progres easing segmen masuk ke keyframe b (easing b dipakai). k = 0..1 linear. */
function applyEasing(k: number, kf: Keyframe): number {
  if (kf.easeName) {
    const p = kf.easeParams ?? [];
    switch (kf.easeName) {
      case 'hold':
      case 'step':
        return 0;
      case 'elastic':
        return elasticEase(k, false, p);
      case 'reverse elastic':
        return elasticEase(k, true, p);
      case 'bounce':
        return bounceEase(k);
      case 'overshoot':
        return backEase(k, true);
      case 'anticipate':
        return backEase(k, false);
      default:
        return k;
    }
  }
  if (kf.e) return cubicBezier(kf.e[0], kf.e[1], kf.e[2], kf.e[3], k);
  return k;
}

/** Baca <kf>; t fraksi → ms memakai durasi layer; diurutkan menurut waktu. */
function readKeyframes(el: El, start: number, span: number, unknownEase: Set<string>): Keyframe[] {
  const out: Keyframe[] = [];
  for (const kf of kids(el, 'kf')) {
    const v = nums(attr(kf, 'v'));
    if (!v.length) continue;
    const parsed = parseEasing(attr(kf, 'e'), unknownEase);
    out.push({
      t: start + num(attr(kf, 't'), 0) * span,
      v,
      e: parsed.bezier,
      easeName: parsed.name,
      easeParams: parsed.params,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

function readEffect(e: El, index: number, start: number, span: number, unknownEase: Set<string>): LayerEffect {
  const id = attr(e, 'id') ?? `fx-${index}`;
  const params: Record<string, EffectParam> = {};
  for (const p of kids(e, 'property')) {
    const name = attr(p, 'name');
    if (!name) continue;
    const kfs = readKeyframes(p, start, span, unknownEase);
    const raw = attr(p, 'value') ?? '';
    params[name] = { value: kfs.length ? kfs[0].v : nums(raw), keyframes: kfs.length ? kfs : undefined, raw };
  }
  return { id, name: id.split('.').pop() ?? id, enabled: attr(e, 'enabled') !== 'false', params };
}

/** Baca <shadow direction="outside"> → {color, blur, offsetX, offsetY}. */
function readShadow(el: El): Layer['shadow'] {
  const colorEl = kids(el, 'color')[0];
  const sizeEl = kids(el, 'size')[0];
  const offEl = kids(el, 'offset')[0];
  const off = nums(attr(offEl, 'value'));
  return {
    color: argbToCss(attr(colorEl, 'value'), '#000000'),
    blur: num(attr(sizeEl, 'value'), 0),
    offsetX: off[0] ?? 0,
    offsetY: off[1] ?? 0,
  };
}

type Ctx = { warnings: string[]; unknownEase: Set<string>; unknownTransform: Set<string>; mediaDecls: Map<string, MediaDecl> };

function parseLayer(el: El, index: number, sceneDuration: number, ctx: Ctx, timeOffset = 0): Layer {
  const tag = el.tag;
  const start = timeOffset + num(attr(el, 'startTime'), 0);
  const endRaw = attr(el, 'endTime');
  const end = Math.max(timeOffset + (endRaw !== undefined ? num(endRaw) : sceneDuration), start + 1);
  const span = end - start;

  const fillType = attr(el, 'fillType') as Layer['fillType'] | undefined;
  const fillImage = attr(el, 'fillImage');
  const fillVideo = attr(el, 'fillVideo');
  const fillAudio = attr(el, 'fillAudio');
  const srcRef = fillImage ?? fillVideo ?? fillAudio ?? attr(el, 'src') ?? null;

  let type: LayerType = LAYER_TAGS[tag] ?? 'other';
  if (fillType === 'media' && (type === 'shape' || type === 'image')) {
    type = fillVideo !== undefined || /\/video\//i.test(srcRef ?? '') ? 'video' : 'image';
  }
  const label = attr(el, 'label') ?? attr(el, 'name');

  // ── transform ──
  const keyframes: Record<string, Keyframe[]> = {};
  const staticVals: Record<string, number[]> = {};
  const transform = kids(el, 'transform')[0];
  for (const child of transform?.children ?? []) {
    if (!['location', 'scale', 'rotation', 'opacity'].includes(child.tag)) {
      ctx.unknownTransform.add(child.tag);
      continue;
    }
    const kfs = readKeyframes(child, start, span, ctx.unknownEase);
    if (kfs.length) keyframes[child.tag] = kfs;
    const val = attr(child, 'value');
    if (val !== undefined) staticVals[child.tag] = nums(val);
  }
  const first = (prop: string, fb: number[]): number[] => keyframes[prop]?.[0]?.v ?? staticVals[prop] ?? fb;
  const loc = first('location', [0, 0]);
  const scl = first('scale', [1, 1]);
  const rot = first('rotation', [0]);
  const opa = first('opacity', [1]);

  // ── properti bentuk ──
  let width = 0;
  let height = 0;
  let cornerRadius = 0;
  for (const p of kids(el, 'property')) {
    const name = attr(p, 'name');
    const val = nums(attr(p, 'value'));
    if (name === 'size' && val.length >= 2) [width, height] = val;
    if (name === 'cornerRadius' && val.length) cornerRadius = val[0];
  }

  // ── isian ──
  const gradEl = kids(el, 'gradient')[0];
  let gradient: Layer['gradient'];
  if (gradEl) {
    const s = nums(attr(gradEl, 'start'));
    const e = nums(attr(gradEl, 'end'));
    gradient = {
      type: attr(gradEl, 'type') ?? 'linear',
      startColor: argbToCss(attr(gradEl, 'startColor'), '#000000'),
      endColor: argbToCss(attr(gradEl, 'endColor'), '#ffffff'),
      start: [s[0] ?? 0, s[1] ?? 0],
      end: [e[0] ?? 1, e[1] ?? 1],
    };
  }

  const effects = kids(el, 'effect').map((e, i) => readEffect(e, i, start, span, ctx.unknownEase));

  // ── stroke & shadow ──
  let stroke: Layer['stroke'];
  const strokeEl = el.children.find((c) => c.tag === 'path-stroke');
  if (strokeEl) {
    const colorEl = kids(strokeEl, 'color')[0];
    const sizeEl = kids(strokeEl, 'size')[0];
    stroke = {
      color: argbToCss(attr(colorEl, 'value'), '#ffffff'),
      width: num(attr(sizeEl, 'value'), 0),
    };
  }
  const shadowEl = el.children.find((c) => c.tag === 'shadow');
  const shadow = shadowEl ? readShadow(shadowEl) : undefined;

  // ── anak layer (hanya kontainer) ──
  let childLayers: Layer[] = [];
  if (CONTAINER_TAGS.has(tag)) {
    // <embedScene> membungkus <scene> bercabang dengan timeline sendiri → geser waktu anak
    // sebesar startTime embed ini sehingga anak-anaknya hidup di jendela waktu embed.
    const nested = tag === 'embedScene' ? kids(el, 'scene')[0] : undefined;
    const source = nested ?? el;
    const nestedTotal = nested ? num(attr(nested, 'totalTime'), span) : span;
    childLayers = source.children
      .filter((c) => c.tag in LAYER_TAGS)
      .map((c, i) => parseLayer(c, i, nestedTotal || span, ctx, nested ? start : 0));
  }

  const speed = attr(el, 'speed');
  if (speed && Math.abs(num(speed, 1) - 1) > 0.001 && (type === 'video' || type === 'audio')) {
    ctx.warnings.push(`Layer "${label ?? attr(el, 'id')}" memakai speed ${speed}×; pemutaran media disesuaikan perkiraan.`);
  }

  return {
    id: attr(el, 'id') ?? `layer-${index}`,
    name: label ?? `${tag} ${index + 1}`,
    type,
    start,
    end,
    visible: tag === 'nullobj' ? false : attr(el, 'hidden') !== 'true' && attr(el, 'visible') !== 'false',
    x: loc[0] ?? 0,
    y: loc[1] ?? 0,
    scaleX: scl[0] ?? 1,
    scaleY: scl[1] ?? scl[0] ?? 1,
    rotation: rot[0] ?? 0,
    opacity: Math.min(1, Math.max(0, opa[0] ?? 1)),
    width,
    height,
    color: argbToCss(attr(kids(el, 'fillColor')[0], 'value'), '#3d4f9a'),
    text: attr(el, 'text') ?? '',
    mediaRef: srcRef,
    effects,
    keyframes,
    children: childLayers,
    raw: { ...el.attrs },
    shape: attr(el, 's')?.replace(/^\./, ''),
    cornerRadius,
    fillType,
    fillMode: attr(el, 'mediaFillMode'),
    gradient,
    blending: attr(el, 'blending'),
    stroke,
    shadow,
    isNull: tag === 'nullobj',
  };
}

function flatten(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  for (const l of layers) {
    out.push(l);
    if (l.children.length) out.push(...flatten(l.children));
  }
  return out;
}

/** Efek yang SUDAH dihampiri renderer canvas; efek lain tetap dilaporkan. */
export const APPROXIMATED_EFFECTS = [
  'gaussianblur',
  'hueshift',
  'exposure',
  'satvib',
  'sharpen',
  'lumakey',
  'tile',
  'swing',
  'oscillate',
  'randomdisplace',
  'motionblur',
  'fade',
  'wipe',
  'lift',
  'zoomblur',
  'circularripple',
  'wavewarp',
  'displacemap',
  'fourcolorgradient',
  'brightcont',
  'gradientoverlay',
  'stretchsegment',
  'mirror',
];

export function parseAmXml(text: string, source: Scene['source'] = 'xml'): Scene {
  const body = text.replace(/^\uFEFF/, '').trim();
  if (!body) throw new XmlError('File XML kosong.');
  if (/^<!doctype html|^<html/i.test(body)) {
    throw new XmlError('Isi file adalah halaman web (HTML), bukan XML preset.');
  }

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
  });

  let tree: El[];
  try {
    tree = toTree(parser.parse(body));
  } catch {
    throw new XmlError('XML tidak valid atau file terpotong.');
  }

  const root = tree.find((n) => n.tag === 'scene');
  if (!root) {
    throw new XmlError(
      'Tidak ada elemen <scene> di XML ini. Pastikan file hasil "Export Project Package (XML)" dari Alight Motion.',
    );
  }

  const ctx: Ctx = {
    warnings: [],
    unknownEase: new Set(),
    unknownTransform: new Set(),
    mediaDecls: new Map<string, MediaDecl>(),
  };
  const width = Math.round(num(attr(root, 'width'), 0)) || 1080;
  const height = Math.round(num(attr(root, 'height'), 0)) || 1920;
  const fps = Math.min(120, Math.max(1, Math.round(num(attr(root, 'fps'), 30))));
  const totalTime = num(attr(root, 'totalTime'), 0);

  // Deklarasi <media>: media asli perangkat pembuat preset (judul, ukuran, durasi).
  for (const m of kids(root, 'media')) {
    const uri = attr(m, 'uri');
    if (!uri) continue;
    ctx.mediaDecls.set(uri, {
      uri,
      filename: attr(m, 'filename') ?? uri,
      title: attr(m, 'title') ?? attr(m, 'filename') ?? uri,
      mime: attr(m, 'type') ?? 'application/octet-stream',
      width: Math.round(num(attr(m, 'width'), 0)),
      height: Math.round(num(attr(m, 'height'), 0)),
      durationMs: Math.round(num(attr(m, 'duration'), 0) / 1000),
    });
  }

  const layers: Layer[] = [];
  const skipped = new Set<string>();
  root.children.forEach((c) => {
    if (c.tag === 'bookmark' || c.tag === 'media') return;
    if (!(c.tag in LAYER_TAGS)) {
      skipped.add(c.tag);
      return;
    }
    layers.push(parseLayer(c, layers.length, totalTime || 5000, ctx));
  });
  if (skipped.size) ctx.warnings.push(`Elemen belum dikenali dan dilewati: ${[...skipped].map((t) => `<${t}>`).join(', ')}.`);

  if (!layers.length) {
    throw new XmlError('XML ini tidak berisi layer apa pun (shape/video/image/audio).');
  }

  const all = flatten(layers);
  const maxEnd = all.reduce((m, l) => Math.max(m, l.end), 0);
  const duration = Math.round(totalTime > 0 ? totalTime : maxEnd || 5000);
  const mediaRefs = Array.from(new Set(all.map((l) => l.mediaRef).filter((v): v is string => Boolean(v))));
  const effectCount = all.reduce((n, l) => n + l.effects.length, 0);

  const bookmarks = kids(root, 'bookmark')
    .map((b) => num(attr(b, 't'), NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const unsupported = new Map<string, number>();
  for (const l of all) {
    for (const fx of l.effects) {
      const base = fx.name.replace(/\d+$/, '');
      if (!APPROXIMATED_EFFECTS.includes(base)) unsupported.set(base, (unsupported.get(base) ?? 0) + 1);
    }
  }
  if (unsupported.size) {
    const list = [...unsupported.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`);
    ctx.warnings.push(`Efek ini belum didukung renderer: ${list.join(', ')}.`);
  }
  if (ctx.unknownEase.size) ctx.warnings.push(`Kurva easing tak dikenal diperlakukan linear: ${[...ctx.unknownEase].join(', ')}.`);
  if (ctx.unknownTransform.size) ctx.warnings.push(`Properti transform belum didukung: ${[...ctx.unknownTransform].join(', ')}.`);
  if (mediaRefs.length) {
    ctx.warnings.push(
      `Preset merujuk ${mediaRefs.length} media dari perangkat asal (tidak ikut di file XML). Pasang media kamu di tab Media.`,
    );
  }

  return {
    name: attr(root, 'title') ?? 'Preset tanpa nama',
    width,
    height,
    fps,
    duration,
    layers,
    mediaRefs,
    effectCount,
    warnings: ctx.warnings,
    source,
    bgColor: argbToCss(attr(root, 'bgcolor'), '#000000'),
    bookmarks,
    mediaDecls: ctx.mediaDecls.size ? Array.from(ctx.mediaDecls.values()) : [],
    audioTracks: [],
  };
}

/* ───────────── evaluasi keyframe (dipakai renderer & inspector) ───────────── */

/** cubic-bezier gaya CSS: kembalikan y untuk progres x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const err = sx(t) - x;
    if (Math.abs(err) < 1e-6) return sy(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i += 1) {
    const v = sx(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sy(t);
}

/** Nilai komponen `idx` dari keyframe pada waktu t (ms), dengan easing masuk. */
export function sampleKeyframes(kfs: Keyframe[] | undefined, t: number, idx: number, fallback: number): number {
  if (!kfs || !kfs.length) return fallback;
  if (t <= kfs[0].t) return kfs[0].v[idx] ?? fallback;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v[idx] ?? fallback;
  for (let i = 0; i < kfs.length - 1; i += 1) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      let k = span > 0 ? (t - a.t) / span : 1;
      k = applyEasing(k, b);
      const av = a.v[idx] ?? fallback;
      const bv = b.v[idx] ?? fallback;
      return av + (bv - av) * k;
    }
  }
  return fallback;
}

export const valueAt = (layer: Layer, prop: string, t: number, fallback: number): number =>
  sampleKeyframes(layer.keyframes[prop], t, 0, fallback);

export const pairAt = (layer: Layer, prop: string, t: number, fx: number, fy: number): [number, number] => [
  sampleKeyframes(layer.keyframes[prop], t, 0, fx),
  sampleKeyframes(layer.keyframes[prop], t, 1, fy),
];
