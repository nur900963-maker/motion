/** Satu keyframe. t = ms pada timeline scene (sudah dikonversi dari fraksi durasi layer). */
export type Keyframe = {
  t: number;
  v: number[];
  /** Easing untuk segmen yang MASUK ke keyframe ini: cubic-bezier [x1,y1,x2,y2]; kosong = linear. */
  e?: [number, number, number, number];
};

export type LayerType = 'image' | 'video' | 'audio' | 'text' | 'shape' | 'scene' | 'group' | 'other';

export type EffectParam = { value: number[]; keyframes?: Keyframe[]; raw: string };

export type LayerEffect = {
  id: string;
  name: string;
  enabled: boolean;
  params?: Record<string, EffectParam>;
};

export type Layer = {
  id: string;
  name: string;
  type: LayerType;
  start: number;
  end: number;
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
  effects: LayerEffect[];
  keyframes: Record<string, Keyframe[]>;
  children: Layer[];
  raw: Record<string, string>;
  /** Bentuk geometri layer: rect | roundrect | circle | dll. */
  shape?: string;
  cornerRadius?: number;
  /** Cara layer diisi: media (gambar/video), warna solid, atau gradien. */
  fillType?: 'media' | 'color' | 'gradient';
  fillMode?: string;
  gradient?: { type: string; startColor: string; endColor: string; start: [number, number]; end: [number, number] };
  blending?: string;
};

export type Scene = {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  layers: Layer[];
  mediaRefs: string[];
  effectCount: number;
  warnings: string[];
  source: 'xml' | 'am' | 'drive' | 'sample';
  bgColor?: string;
  bookmarks?: number[];
};

export type MediaItem = {
  id: number;
  name: string;
  mime: string;
  kind: 'image' | 'video' | 'audio' | 'other';
  size: number;
  url: string;
  projectId: number | null;
};

/** Proyek yang disimpan di browser (IndexedDB), bukan di server. */
export type LocalProject = {
  id: number;
  name: string;
  scene: Scene;
  xmlText: string | null;
  sourceUrl: string | null;
  updatedAt: number;
};

export type ExportSettings = {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  startMs: number;
  endMs: number;
  format: 'webm' | 'mp4';
  includeAudio: boolean;
};

export const RESOLUTIONS = [
  { label: '270p (hemat)', w: 270, h: 480 },
  { label: '360p', w: 360, h: 640 },
  { label: '480p', w: 480, h: 854 },
  { label: '720p (HD)', w: 720, h: 1280 },
  { label: '960p (qHD)', w: 960, h: 1706 },
  { label: '1080p (Full HD)', w: 1080, h: 1920 },
  { label: '1440p (2K)', w: 1440, h: 2560 },
  { label: '2160p (4K UHD)', w: 2160, h: 3840 },
] as const;

export function fmtTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function layerColor(type: LayerType): string {
  switch (type) {
    case 'image':
      return '#3d4f9a';
    case 'video':
      return '#2a7a4b';
    case 'audio':
      return '#8a6a1f';
    case 'text':
      return '#7a3d8a';
    case 'shape':
      return '#1f6a8a';
    case 'scene':
      return '#8a4a1f';
    default:
      return '#3a3a42';
  }
}
