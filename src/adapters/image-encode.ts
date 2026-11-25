import { approximateDataBytes } from '../domain/images';

export interface PreparedImage {
  dataUrl: string;
  filename: string;
}

interface ImageLike {
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
}

interface CanvasContextLike {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: unknown, x: number, y: number, width: number, height: number): void;
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasContextLike | null;
  toDataURL(type?: string, quality?: number): string;
}

interface CanvasDocument {
  createElement(tag: 'canvas'): CanvasLike;
}

export function encodeImageForWechat(image: ImageLike, documentLike: CanvasDocument): string | null {
  const canvas = documentLike.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const naturalWidth = image.naturalWidth || image.width || 0;
  const naturalHeight = image.naturalHeight || image.height || 0;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(1, 1600 / naturalWidth, 3000 / naturalHeight);
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  let quality = 0.9;
  let encoded = canvas.toDataURL('image/jpeg', quality);
  while (approximateDataBytes(encoded) > 980000 && quality > 0.5) {
    quality = Math.round((quality - 0.1) * 100) / 100;
    encoded = canvas.toDataURL('image/jpeg', quality);
  }
  if (approximateDataBytes(encoded) > 1000000 && (width > 640 || height > 640)) {
    const smaller = documentLike.createElement('canvas');
    const smallContext = smaller.getContext('2d');
    if (smallContext) {
      for (const factor of [0.7, 0.55, 0.4]) {
        smaller.width = Math.max(1, Math.round(width * factor));
        smaller.height = Math.max(1, Math.round(height * factor));
        smallContext.fillStyle = '#ffffff';
        smallContext.fillRect(0, 0, smaller.width, smaller.height);
        smallContext.drawImage(image, 0, 0, smaller.width, smaller.height);
        for (const smallQuality of [0.7, 0.5]) {
          const smallEncoded = smaller.toDataURL('image/jpeg', smallQuality);
          if (approximateDataBytes(smallEncoded) <= 1000000) {
            encoded = smallEncoded;
            break;
          }
        }
        if (approximateDataBytes(encoded) <= 1000000) break;
      }
    }
  }
  if (approximateDataBytes(encoded) > 1000000) return null;
  return encoded;
}

export function prepareImageForWechat(dataUrl: unknown): Promise<PreparedImage> {
  return new Promise<PreparedImage>(function (resolve) {
    const sourceDataUrl = String(dataUrl || '');
    const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(sourceDataUrl);
    const mime = match ? match[1].toLowerCase() : '';
    const sourceExt = mime === 'image/png' ? 'png' : 'jpg';
    const fallback: PreparedImage = {
      dataUrl: sourceDataUrl,
      filename: 'image-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.' + sourceExt,
    };
    if (!match) {
      resolve(fallback);
      return;
    }
    if (
      (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') &&
      approximateDataBytes(dataUrl) <= 1000000
    ) {
      resolve(fallback);
      return;
    }
    try {
      if (typeof Image === 'undefined' || typeof document === 'undefined') {
        resolve(fallback);
        return;
      }
      const image = new Image();
      let settled = false;
      function done(value: PreparedImage): void {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      image.onerror = function () {
        done(fallback);
      };
      image.onload = function () {
        try {
          const encoded = encodeImageForWechat(image, document as unknown as CanvasDocument);
          if (!encoded) {
            done(fallback);
            return;
          }
          done({
            dataUrl: encoded,
            filename: 'image-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg',
          });
        } catch {
          done(fallback);
        }
      };
      image.src = sourceDataUrl;
    } catch {
      resolve(fallback);
    }
  });
}
