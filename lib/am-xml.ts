import { XMLParser } from 'fast-xml-parser';

/**
 * Parser XML Alight Motion yang toleran.
 *
 * Alight Motion menyimpan proyek sebagai XML dengan root <project> berisi satu atau
 * beberapa <scene>, dan tiap scene berisi <layer>. Varian versi AM berbeda-beda:
 * sebagian menyimpan nilai di atribut (value="..."), sebagian di elemen anak
 * (<property name="location"><kf t="0" v="0,0"/></property>). Parser ini membaca
 * keduanya dan TIDAK mengarang nilai yang tidak ada: properti yang tidak ditemukan
 * dibiarkan pada nilai default dan dicatat di `warnings`.
 */

export type Keyframe = { t: number; v: number[] };

export type LayerType = 'image' | 'video' | 'audio' | 'text' | 'shape' | 'scene' | 'group' | 'other';

export type Layer = {
  id: string;
  name: string;
  type: LayerType;
  start: number; // ms
  end: number; // ms
  visible: boolean;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  width: number;
  height: number;
  color: string;
  text: string;
  mediaRef: string | null;
  effects: { id: string; name: string; enabled: boolean }[];
  keyframes: Record<string, Keyframe[]>;
  children: Layer[];
  raw: Record<string, string>;
};

export type Scene = {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number; // ms
  layers: Layer[];
  mediaRefs: string[];
  effectCount: number;
  warnings: string[];
  source: 'xml' | 'am' | 'drive' | 'sample';
};

const LAYER_TYPES: Record<string, LayerType> = {
  image: 'image',
  img: 'image',
  photo: 'image',
  video: 'video',
  movie: 'video',
  audio: 'audio',
  sound: 'audio',
  text: 'text',
  shape: 'shape',
  rect: 'shape',
  ellipse: 'shape',
  scene: 'scene',
  group: 'group',
  precomp: 'scene',
  embed: 'scene',
};

const PROP_ALIASES: Record<string, string> = {
  location: 'location',
  position: 'location',
  translate: 'location',
  scale: 'scale',
  size: 'size',
  rotation: 'rotation',
  rotate: 'rotation',
  opacity: 'opacity',
  alpha: 'opacity',
  anchor: 'anchor',
  color: 'color',
  fill: 'color',
  text: 'text',
  content: 'text',
};

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function nums(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => num(x));
  if (typeof v === 'string') {
    return v
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((x) => num(x));
  }
  if (typeof v === 'number') return [v];
  return [];
}

function attr(node: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = node[`@_${n}`];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

function children(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return [];
  return Object.values(node as Record<string, unknown>).filter(
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v),
  );
}

function named(node: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const v = node[name];
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).filter(
    (x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object',
  );
}

/** Cari semua node bernama `name` di seluruh pohon. */
function findAll(node: unknown, name: string, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (!node || typeof node !== 'object' || depth > 40) return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (key === name) out.push(item as Record<string, unknown>);
      findAll(item, name, out, depth + 1);
    }
  }
  return out;
}

function readKeyframes(node: Record<string, unknown>): Keyframe[] {
  const kfs: Keyframe[] = [];
  for (const tag of ['kf', 'keyframe', 'kfrm', 'key']) {
    for (const kf of named(node, tag)) {
      const t = num(attr(kf, 't', 'time', 'frame'));
      const v = nums(attr(kf, 'v', 'value') ?? kf['#text']);
      if (v.length) kfs.push({ t, v });
    }
  }
  return kfs.sort((a, b) => a.t - b.t);
}

function readProperties(layerNode: Record<string, unknown>): {
  props: Record<string, number[]>;
  keyframes: Record<string, Keyframe[]>;
  text: string;
  color: string;
} {
  const props: Record<string, number[]> = {};
  const keyframes: Record<string, Keyframe[]> = {};
  let text = '';
  let color = '';

  const propNodes = findAll(layerNode, 'property');
  for (const p of propNodes) {
    const rawName = (attr(p, 'name', 'key', 'id') ?? '').toLowerCase();
    const canonical = PROP_ALIASES[rawName];
    if (!canonical) continue;
    const value = attr(p, 'value', 'v');
    if (canonical === 'text') {
      text = value ?? String(p['#text'] ?? '');
      continue;
    }
    if (canonical === 'color') {
      color = value ?? '';
      continue;
    }
    const kfs = readKeyframes(p);
    if (kfs.length) {
      keyframes[canonical] = kfs;
      props[canonical] = kfs[0].v;
    } else if (value !== undefined) {
      props[canonical] = nums(value);
    }
  }

  // Varian yang menaruh properti langsung sebagai atribut layer.
  for (const [rawName, canonical] of Object.entries(PROP_ALIASES)) {
    if (props[canonical] || keyframes[canonical]) continue;
    const v = attr(layerNode, rawName);
    if (v === undefined) continue;
    if (canonical === 'text') text = v;
    else if (canonical === 'color') color = v;
    else props[canonical] = nums(v);
  }

  return { props, keyframes, text, color };
}

function layerTypeOf(node: Record<string, unknown>): LayerType {
  const raw = (attr(node, 'type', 'kind', 'class') ?? '').toLowerCase();
  for (const [k, v] of Object.entries(LAYER_TYPES)) {
    if (raw.includes(k)) return v;
  }
  if (named(node, 'text').length || attr(node, 'text')) return 'text';
  return 'other';
}

function mediaRefOf(node: Record<string, unknown>): string | null {
  const direct = attr(node, 'src', 'source', 'media', 'uri', 'file', 'path');
  if (direct) return direct;
  for (const tag of ['media', 'source', 'asset', 'file']) {
    for (const m of named(node, tag)) {
      const v = attr(m, 'src', 'uri', 'id', 'name', 'path');
      if (v) return v;
    }
  }
  return null;
}

function parseLayer(node: Record<string, unknown>, index: number, warnings: string[]): Layer {
  const { props, keyframes, text, color } = readProperties(node);
  const start = num(attr(node, 'startTime', 'start', 'in'), 0);
  const endRaw = attr(node, 'endTime', 'end', 'out');
  const durationRaw = attr(node, 'duration');
  const end = endRaw !== undefined ? num(endRaw) : durationRaw !== undefined ? start + num(durationRaw) : start + 5000;

  const loc = props.location ?? [0, 0];
  const scale = props.scale ?? [1, 1];
  const size = props.size ?? [0, 0];
  const rot = props.rotation ?? [0];
  const op = props.opacity ?? [1];

  const effects = findAll(node, 'effect').map((e, i) => ({
    id: attr(e, 'id') ?? `fx-${index}-${i}`,
    name: attr(e, 'name', 'type', 'id') ?? `effect-${i}`,
    enabled: attr(e, 'enabled', 'visible') !== 'false',
  }));

  const childLayers = named(node, 'layer').map((c, i) => parseLayer(c, i, warnings));

  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@_')) raw[k.slice(2)] = String(v);
  }

  const type = layerTypeOf(node);
  if (type === 'other' && !effects.length && !childLayers.length) {
    warnings.push(`Layer "${attr(node, 'label', 'name') ?? attr(node, 'id') ?? index}" tipenya tidak dikenali; dirender sebagai kotak netral.`);
  }

  return {
    id: attr(node, 'id') ?? `layer-${index}`,
    name: attr(node, 'label', 'name', 'title') ?? attr(node, 'id') ?? `Layer ${index + 1}`,
    type,
    start,
    end: Math.max(end, start + 1),
    visible: attr(node, 'visible', 'hidden') !== 'false' && attr(node, 'hidden') !== 'true',
    x: loc[0] ?? 0,
    y: loc[1] ?? 0,
    scaleX: scale[0] ?? 1,
    scaleY: scale[1] ?? scale[0] ?? 1,
    rotation: rot[0] ?? 0,
    opacity: Math.min(1, Math.max(0, op[0] ?? 1)),
    width: size[0] ?? 0,
    height: size[1] ?? 0,
    color: color || '#3d4f9a',
    text,
    mediaRef: mediaRefOf(node),
    effects,
    keyframes,
    children: childLayers,
    raw,
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

export class XmlError extends Error {}

/** Bungkus fragmen (file grup/cc tanpa root tunggal) agar tetap bisa diparse. */
function normalizeXml(text: string): string {
  const body = text
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!body) throw new XmlError('File XML kosong.');
  return body;
}

export function parseAmXml(text: string, source: Scene['source'] = 'xml'): Scene {
  const body = normalizeXml(text);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ['layer', 'effect', 'property', 'kf', 'keyframe', 'scene', 'media'].includes(name),
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(body) as Record<string, unknown>;
  } catch {
    try {
      doc = parser.parse(`<xm-fragment>${body}</xm-fragment>`) as Record<string, unknown>;
    } catch {
      throw new XmlError('XML tidak valid atau file terpotong.');
    }
  }

  const warnings: string[] = [];
  const projectNodes = findAll(doc, 'project');
  const sceneNodes = findAll(doc, 'scene');
  const root = projectNodes[0] ?? sceneNodes[0] ?? (doc as Record<string, unknown>);

  const width = num(attr(root, 'width', 'exportWidth', 'w'), 0) || num(attr(sceneNodes[0] ?? {}, 'width'), 1080);
  const height = num(attr(root, 'height', 'exportHeight', 'h'), 0) || num(attr(sceneNodes[0] ?? {}, 'height'), 1920);
  const fps = num(attr(root, 'fps', 'frameRate'), 0) || num(attr(sceneNodes[0] ?? {}, 'fps'), 30);

  const layerNodes = findAll(doc, 'layer');
  if (!layerNodes.length) {
    throw new XmlError('Tidak ada <layer> di dalam XML ini. Pastikan file adalah preset/proyek Alight Motion, bukan file lain.');
  }

  const layers = layerNodes
    .filter((n) => !findAll(n, 'layer').some((inner) => inner !== n && layerNodes.includes(inner)))
    .map((n, i) => parseLayer(n, i, warnings));

  const all = flatten(layers);
  const durationAttr = num(attr(root, 'duration', 'length'), 0) || num(attr(sceneNodes[0] ?? {}, 'duration'), 0);
  const maxEnd = all.reduce((m, l) => Math.max(m, l.end), 0);
  const duration = durationAttr > 0 ? durationAttr : maxEnd || 5000;

  const mediaRefs = Array.from(
    new Set(all.map((l) => l.mediaRef).filter((v): v is string => Boolean(v))),
  );
  const effectCount = all.reduce((n, l) => n + l.effects.length, 0);

  const name =
    attr(root, 'name', 'title', 'label') ??
    attr(sceneNodes[0] ?? {}, 'name', 'label') ??
    'Preset tanpa nama';

  if (!all.some((l) => l.type === 'image' || l.type === 'video')) {
    warnings.push('Tidak ada layer gambar/video yang terdeteksi; preset mungkin hanya berisi teks/bentuk.');
  }

  return {
    name,
    width: Math.round(width) || 1080,
    height: Math.round(height) || 1920,
    fps: Math.min(120, Math.max(1, Math.round(fps) || 30)),
    duration: Math.round(duration),
    layers,
    mediaRefs,
    effectCount,
    warnings,
    source,
  };
}

/** Nilai properti pada waktu t (ms) dengan interpolasi linear antar keyframe. */
export function valueAt(layer: Layer, prop: string, t: number, fallback: number): number {
  const kfs = layer.keyframes[prop];
  if (!kfs || !kfs.length) return fallback;
  if (t <= kfs[0].t) return kfs[0].v[0] ?? fallback;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v[0] ?? fallback;
  for (let i = 0; i < kfs.length - 1; i += 1) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      const k = (t - a.t) / span;
      const av = a.v[0] ?? fallback;
      const bv = b.v[0] ?? fallback;
      return av + (bv - av) * k;
    }
  }
  return fallback;
}

export function pairAt(layer: Layer, prop: string, t: number, fx: number, fy: number): [number, number] {
  const kfs = layer.keyframes[prop];
  if (!kfs || !kfs.length) return [fx, fy];
  const pick = (arr: Keyframe[], idx: number, fb: number) => {
    if (t <= arr[0].t) return arr[0].v[idx] ?? fb;
    const last = arr[arr.length - 1];
    if (t >= last.t) return last.v[idx] ?? fb;
    for (let i = 0; i < arr.length - 1; i += 1) {
      const a = arr[i];
      const b = arr[i + 1];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        const av = a.v[idx] ?? fb;
        const bv = b.v[idx] ?? fb;
        return av + (bv - av) * k;
      }
    }
    return fb;
  };
  return [pick(kfs, 0, fx), pick(kfs, 1, fy)];
}
