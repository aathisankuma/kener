// Fetches a Cloud Service provider's own icon from its status page or web app and stores it as a
// Kener image, so a monitor shows the service's logo without anyone uploading it.
import axios from "axios";
import sharp from "sharp";
import GC from "../global-constants.js";
import { GetCloudProvider, IsStatusPageKind } from "../cloudServices.js";
import type { CloudServiceMonitorTypeData } from "./types/monitor.js";
import { CloudHttpOptions, StatuspageBase } from "./cloudProviderClient.js";
import { uploadImage } from "./controllers/imageController.js";

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_ICON_BYTES = 1024 * 1024;

export interface IconLink {
  href: string;
  rel: string;
  sizes: string;
  type: string;
}

/** The <link> icons an HTML page declares, best first: touch icons, then the largest, then PNG. */
export function FindIconLinks(html: string, pageUrl: string): string[] {
  const links: IconLink[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      (tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) ?? [])
        .slice(1)
        .find((v) => v !== undefined) ?? "";
    const rel = attr("rel").toLowerCase();
    const href = attr("href");
    if (!href || !/\b(icon|apple-touch-icon(-precomposed)?|mask-icon)\b/.test(rel)) continue;
    if (rel.includes("mask-icon")) continue; // single-colour Safari icon, not the logo
    links.push({ href, rel, sizes: attr("sizes").toLowerCase(), type: attr("type").toLowerCase() });
  }
  const size = (l: IconLink) => Math.max(0, ...l.sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
  const score = (l: IconLink) =>
    (l.rel.includes("apple-touch-icon") ? 10000 : 0) +
    Math.min(size(l), 512) * 10 +
    (l.type.includes("png") || /\.png(\?|$)/i.test(l.href) ? 5 : 0);
  const ordered = links.sort((a, b) => score(b) - score(a)).map((l) => l.href);
  const resolved: string[] = [];
  for (const href of [...ordered, "/favicon.ico"]) {
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), pageUrl).toString();
      if (/^https?:\/\//i.test(url) && !resolved.includes(url)) resolved.push(url);
    } catch {
      /* not a usable URL */
    }
  }
  return resolved;
}

/**
 * The largest PNG inside a Windows .ico file, or null. Modern .ico files store PNG images; older
 * BMP entries are skipped.
 */
export function PngFromIco(buffer: Buffer): Buffer | null {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = buffer.readUInt16LE(4);
  let best: { size: number; data: Buffer } | null = null;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > buffer.length) break;
    const width = buffer[entry] || 256;
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (offset + length > buffer.length) continue;
    const data = buffer.subarray(offset, offset + length);
    const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (isPng && (!best || width > best.size)) best = { size: width, data };
  }
  return best?.data ?? null;
}

/** An image response as PNG/JPEG/WebP that Kener's image store accepts, or null. */
export async function ToStorableImage(buffer: Buffer): Promise<{ data: Buffer; mimeType: string } | null> {
  const head = buffer.subarray(0, 512).toString("utf8");
  if (/<svg[\s>]/i.test(head) || /<\?xml/i.test(head)) {
    // Rendered to PNG: Kener stores no SVG (script inside an SVG would run when it is served).
    const png = await sharp(buffer, { limitInputPixels: GC.MAX_INPUT_PIXELS })
      .resize(256, 256, { fit: "inside" })
      .png()
      .toBuffer()
      .catch(() => null);
    return png ? { data: png, mimeType: "image/png" } : null;
  }
  const ico = PngFromIco(buffer);
  if (ico) return { data: ico, mimeType: "image/png" };
  const meta = await sharp(buffer, { limitInputPixels: GC.MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => null);
  const mime: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
  const mimeType = meta?.format ? mime[meta.format] : undefined;
  return mimeType ? { data: buffer, mimeType } : null;
}

async function download(url: string, maxBytes: number, timeout: number): Promise<Buffer | null> {
  const response = await axios(url, {
    ...CloudHttpOptions(timeout),
    headers: { ...CloudHttpOptions(timeout).headers, Accept: "*/*" },
    responseType: "arraybuffer",
    maxContentLength: maxBytes,
    maxRedirects: 5,
  }).catch(() => null);
  if (!response || response.status < 200 || response.status >= 300) return null;
  const data = Buffer.from(response.data);
  return data.length > 0 && data.length <= maxBytes ? data : null;
}

/** The web page whose icon stands for this monitor's service, or "" when there is none. */
export function IconPageFor(data: CloudServiceMonitorTypeData): string {
  const provider = GetCloudProvider(data?.provider);
  if (!provider) return "";
  if (provider.iconSite) return provider.iconSite;
  return IsStatusPageKind(provider.kind) ? StatuspageBase(provider, data) : "";
}

/**
 * Downloads the service's own icon and stores it as a Kener image (resized to 128 px at most).
 * Returns the image URL to put in the monitor's `image`, or throws with a reason to show.
 */
export async function FetchCloudServiceIcon(data: CloudServiceMonitorTypeData): Promise<string> {
  const page = IconPageFor(data);
  if (!page) {
    throw new Error("This service has no known icon source. Upload an image instead.");
  }
  const timeout = Math.min(data.timeout || 10000, 15000);
  const htmlBuffer = await download(page, MAX_PAGE_BYTES, timeout);
  const candidates = FindIconLinks(htmlBuffer ? htmlBuffer.toString("utf8") : "", page);
  for (const url of candidates.slice(0, 6)) {
    const raw = await download(url, MAX_ICON_BYTES, timeout);
    if (!raw) continue;
    const image = await ToStorableImage(raw);
    if (!image) continue;
    try {
      const stored = await uploadImage({
        base64: image.data.toString("base64"),
        mimeType: image.mimeType,
        fileName: `cloud-icon-${data.provider}`,
        maxWidth: 128,
        maxHeight: 128,
      });
      return stored.url;
    } catch {
      /* not an image Kener accepts: try the next one */
    }
  }
  throw new Error(`Could not find a usable icon on ${new URL(page).host}. Upload an image instead.`);
}
