/**
 * Memuat gambar untuk GPU. Foto kamera (12 MP+) di-downscale: 4000×3000 piksel = 48 MB tekstur
 * (+ mipmap) dan unggahan berat → penyebab klasik patah-patah & panas di HP.
 */
export const MAX_IMAGE_SIDE = 2048;

export type LoadedImage = HTMLImageElement | HTMLCanvasElement;

export function loadImage(url: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) return resolve(null);
      const big = Math.max(w, h);
      if (big <= MAX_IMAGE_SIDE) return resolve(img);
      try {
        const k = MAX_IMAGE_SIDE / big;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k));
        c.height = Math.max(1, Math.round(h * k));
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(img);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      } catch {
        resolve(img); // memori kanvas habis: pakai aslinya
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
