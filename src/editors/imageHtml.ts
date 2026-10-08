import { escapeHtml as esc } from './propertiesHtml.js';

/** An image definition's content (PSCONTDEFN CONTTYPE 1, its PSCONTENT bytes). */
export interface ImageContent {
  name: string;
  /** PSCONTDEFN.CONTFMT, as stored: gif, png, jpg, svg, bmp ... */
  format: string;
  description: string;
  /** Every ALTCONTNUM of the image: 58 of HRDMO's images have a second. */
  alternates: { altContNum: number; format: string; bytes: Buffer }[];
}

/** The MIME type a CONTFMT is shown as. */
export function imageMimeType(format: string): string {
  switch (format.trim().toLowerCase()) {
    case 'gif': return 'image/gif';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'svg': return 'image/svg+xml';
    case 'bmp': case 'dib': return 'image/bmp';
    case 'cur': return 'image/x-icon';
    case 'web': case 'webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

/**
 * The MIME type the bytes say they are, or undefined: 13 of HRDMO's images
 * stored as gif are JPEG or PNG (NEW_PORTAL_HDR_POPUP, PTACM_ERROR ...), so
 * the bytes decide where they are recognised.
 */
export function sniffImageMimeType(bytes: Buffer): string | undefined {
  const ascii = (from: number, to: number) => bytes.subarray(from, to).toString('latin1');
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0) return 'image/x-icon';
  if (/^\s*(<\?xml|<svg|<!--)/i.test(bytes.subarray(0, 256).toString('utf8'))) return 'image/svg+xml';
  return undefined;
}

export function renderImageHtml(image: ImageContent, connection: string, nonce: string): string {
  const blocks = image.alternates.map((a) => {
    const mime = sniffImageMimeType(a.bytes) ?? imageMimeType(a.format);
    const preview = mime.startsWith('image/')
      ? `<img alt="${esc(image.name)}" src="data:${mime};base64,${a.bytes.toString('base64')}">`
      : '<p>This format cannot be shown.</p>';
    return `<section><h2>${image.alternates.length > 1 ? `Alternate ${a.altContNum}: ` : ''}${esc(a.format.trim().toUpperCase() || '(no format)')}` +
      ` <span class="size">${a.bytes.length.toLocaleString()} bytes</span></h2><div class="frame">${preview}</div></section>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem 1.25rem; }
  h1 { font-size: 1.2rem; margin: 0 0 0.25rem; }
  h2 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }
  .meta, .size { color: var(--vscode-descriptionForeground); font-weight: normal; }
  .frame { display: inline-block; padding: 12px; border: 1px solid var(--vscode-panel-border, transparent);
    background-image: conic-gradient(#8884 25%, transparent 0 50%, #8884 0 75%, transparent 0); background-size: 16px 16px; }
  img { display: block; max-width: 100%; image-rendering: auto; }
</style>
</head>
<body>
<h1>${esc(image.name)}</h1>
<p class="meta">Image on ${esc(connection)}${image.description ? ` -- ${esc(image.description)}` : ''}</p>
${blocks}
</body>
</html>`;
}
