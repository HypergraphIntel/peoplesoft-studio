/* Preview HTML (psft.html.preview): an HTML definition shown as a page, safely. */

/**
 * An HTML definition as a static page: no scripts and nothing fetched (inline styles and data: images only),
 * so a definition's JavaScript or remote content never runs; meta-HTML such as %Bind(:1) shows as written.
 */
export function htmlPreviewPage(html: string): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
  const head = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  // A full document keeps its own structure, with the policy first in its head; a fragment gets a minimal page.
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  return `<!DOCTYPE html><html><head>${head}<meta charset="utf-8"></head><body>${html}</body></html>`;
}
