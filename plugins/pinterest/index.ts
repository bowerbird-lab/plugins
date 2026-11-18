// Pinterest resolver for the native host. The host calls resolveUrl when a
// link is pasted or dropped. Types live in @bowerbird/plugin-sdk, and this
// file is compiled to a single ESM index.js at build time.

import type {
  InspectInput,
  InspectResult,
  PluginAction,
  PluginActionContext,
  PluginUrlResolution,
  ResolveUrlInput,
} from "@bowerbird/plugin-sdk";

interface ParsedPin {
  id: string;
  mpsId: string;
  host: string;
  sourceUrl: string;
  canonicalUrl: string;
  shortLink: boolean;
}

type ParsedInput =
  | { kind: "pin"; pin: ParsedPin; url: string }
  | { kind: "image"; url: string };

interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface PinImageEntry {
  url?: string;
  width?: number;
}

type PinImagesMap = Record<string, PinImageEntry | undefined>;

interface MultiPinItem {
  url: string;
  candidates: string[];
  sourceUrl: string;
  name: string;
  tags: string[];
}

interface MultiPinResult extends PluginUrlResolution {
  folderName: string;
  sourceUrl: string;
  tags: string[];
  items: MultiPinItem[];
}

type FetchPinResult =
  | { multi: MultiPinResult }
  | { pageUrl: string; imageUrl: string; multi?: undefined };

const PINTEREST_HOST_RE = /(^|\.)pinterest\.[a-z.]+$/i;
const PINIMG_HOST_RE = /^i(?:-[a-z0-9]+)?\.pinimg\.com$/i;
const PIN_PATH_RE = /\/pin\/(\d+)/i;
const MULTI_PIN_SHARE_RE = /\/multi-pin-share\/(\d+)/i;
const PINIMG_URL_RE = /(?:https?:)?\/\/i(?:-[a-z0-9]+)?\.pinimg\.com\/[^\s"'<>\\]+?\.(?:jpe?g|png|gif|webp)(?:\?[^\s"'<>\\]*)?/gi;
const META_TAG_RE = /<meta\b[^>]*>/gi;

function normalize(raw: unknown): string {
  let value = String(raw || "").trim();
  if (value.startsWith("//")) value = "https:" + value;
  if (!value.includes("://") && value.includes(".")) value = "https://" + value;
  return value;
}

function parsePin(url: unknown): ParsedPin | null {
  const normalized = normalize(url);
  if (!normalized) return null;
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { return null; }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return null;
  if (hostname === "pin.it" || hostname.endsWith(".pin.it")) {
    return { id: "", mpsId: "", host: hostname, sourceUrl: normalized, canonicalUrl: normalized, shortLink: true };
  }
  if (!PINTEREST_HOST_RE.test(hostname)) return null;
  const mpsMatch = parsed.pathname.match(MULTI_PIN_SHARE_RE);
  if (mpsMatch) {
    return {
      id: "",
      mpsId: mpsMatch[1],
      host: hostname,
      sourceUrl: normalized,
      canonicalUrl: `https://${hostname}/multi-pin-share/${mpsMatch[1]}/`,
      shortLink: false,
    };
  }
  const match = parsed.pathname.match(PIN_PATH_RE);
  if (!match) return null;
  return {
    id: match[1],
    mpsId: "",
    host: hostname,
    sourceUrl: normalized,
    canonicalUrl: `https://${hostname}/pin/${match[1]}/`,
    shortLink: false,
  };
}

function isPinimgHost(hostname: string): boolean {
  return PINIMG_HOST_RE.test(hostname);
}

function isPinimgURL(raw: unknown): boolean {
  try { return isPinimgHost(new URL(normalize(raw)).hostname); } catch { return false; }
}

function parseInput(raw: unknown): ParsedInput | null {
  const pin = parsePin(raw);
  if (pin) return { kind: "pin", pin, url: pin.sourceUrl };
  const normalized = normalize(raw);
  if (isPinimgURL(normalized)) return { kind: "image", url: normalized };
  return null;
}

function decodeEntities(value: unknown): string {
  return String(value)
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#x2f;/gi, "/").replace(/&#47;/gi, "/");
}

function normalizeImageCandidate(raw: unknown): string {
  let candidate = String(raw || "").trim();
  candidate = candidate.replace(/\\\//g, "/").replace(/\\u002f/gi, "/");
  candidate = decodeEntities(candidate);
  candidate = candidate.replace(/^[\s"'()\[\]{}<>,;]+|[\s"'()\[\]{}<>,;]+$/g, "");
  if (candidate.startsWith("//")) candidate = "https:" + candidate;
  if (!/^https?:\/\//i.test(candidate)) return "";
  try { return new URL(candidate).toString(); } catch { return ""; }
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp("\\b" + name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
  return match ? decodeEntities(match[1]) : "";
}

function imageHash(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (!isPinimgHost(parsed.hostname)) return "";
    const base = parsed.pathname.split("/").pop() || "";
    const dot = base.indexOf(".");
    const hash = dot > 0 ? base.slice(0, dot) : base;
    return hash.length >= 8 ? hash.toLowerCase() : "";
  } catch { return ""; }
}

function imageScore(candidate: string): number {
  const lower = candidate.toLowerCase();
  let score = 0;
  try { if (isPinimgHost(new URL(candidate).hostname)) score += 20; } catch {}
  if (lower.includes("/originals/")) score += 130;
  else if (lower.includes("/1200x/")) score += 100;
  else if (lower.includes("/736x/")) score += 80;
  else if (lower.includes("/564x/")) score += 70;
  else if (lower.includes("/474x/")) score += 60;
  else score += 50;
  return score;
}

function bestImageCandidate(candidates: string[]): string {
  let best = "";
  let bestScore = -1;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const score = imageScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function extractImageFromHtml(html: string): string {
  if (!String(html || "").trim()) return "";
  const unescaped = decodeEntities(String(html).replace(/\\\//g, "/").replace(/\\u002f/gi, "/"));
  const metaCandidates: string[] = [];
  for (const tag of unescaped.match(META_TAG_RE) || []) {
    const lower = tag.toLowerCase();
    if (!lower.includes("og:image") && !lower.includes("twitter:image")) continue;
    const candidate = normalizeImageCandidate(attr(tag, "content"));
    if (candidate) metaCandidates.push(candidate);
  }
  const candidates = [...metaCandidates];
  for (const rawCandidate of unescaped.match(PINIMG_URL_RE) || []) {
    const candidate = normalizeImageCandidate(rawCandidate);
    if (candidate) candidates.push(candidate);
  }
  // og:image anchors the current pin. Related pins elsewhere in the HTML also
  // use /originals/ URLs, so only accept candidates with the same content hash.
  for (const metaCandidate of metaCandidates) {
    const anchor = imageHash(metaCandidate);
    if (!anchor) continue;
    const anchored = candidates.filter((candidate) => imageHash(candidate) === anchor);
    if (anchored.length > 0) return bestImageCandidate(anchored);
  }
  return bestImageCandidate(candidates);
}

function splitExtension(pathValue: string): { stem: string; ext: string } {
  const dot = pathValue.lastIndexOf(".");
  if (dot < 0) return { stem: pathValue, ext: "" };
  return { stem: pathValue.slice(0, dot), ext: pathValue.slice(dot + 1).toLowerCase() };
}

function uniqueExtensions(ext: string): string[] {
  const result: string[] = [];
  for (const candidate of [ext, "jpg", "png", "webp", "gif"]) {
    if (candidate && !result.includes(candidate)) result.push(candidate);
  }
  return result;
}

function buildPinimgURL(parsed: URL, pathValue: string): string {
  const copy = new URL(parsed.toString());
  copy.protocol = "https:";
  copy.pathname = pathValue;
  return copy.toString();
}

function pinterestImageCandidates(raw: string): string[] {
  const normalized = normalizeImageCandidate(raw);
  if (!normalized) return [];
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { return [normalized]; }
  if (!isPinimgHost(parsed.hostname)) return [normalized];

  let pathValue = parsed.pathname.replace(/^\/+/, "");
  if (!pathValue) return [normalized];
  if (pathValue.toLowerCase().startsWith("webp/")) pathValue = pathValue.slice("webp/".length);

  const parts = pathValue.split("/");
  if (parts.length < 2) return [normalized];
  const isOriginal = parts[0].toLowerCase() === "originals";
  const rest = parts.slice(1).join("/");
  const { stem, ext } = splitExtension(rest);
  const candidates: string[] = [];
  if (isOriginal) {
    candidates.push(normalized);
  } else {
    for (const candidateExt of uniqueExtensions(ext)) {
      candidates.push(buildPinimgURL(parsed, `/originals/${stem}.${candidateExt}`));
    }
  }
  candidates.push(buildPinimgURL(parsed, `/1200x/${rest}`));
  if (!isOriginal) candidates.push(normalized);
  return [...new Set(candidates.filter(Boolean))];
}

async function host_fetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const hostObj = typeof host !== "undefined" ? host : undefined;
  const cookie = (hostObj?.settings?.get("cookie")) || "";
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; Bowerbird/2.2; +https://github.com/bowerbird-lab/bowerbird)",
    ...(options.headers || {}),
  };
  if (cookie) headers.Cookie = cookie;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: "follow", headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickPinImagesBestUrl(images: PinImagesMap | undefined): string {
  if (!images || typeof images !== "object") return "";
  for (const key of ["orig", "1200x", "750x", "736x", "600x", "564x", "474x", "236x"]) {
    const entry = images[key];
    if (entry && typeof entry.url === "string" && entry.url.trim()) {
      return entry.url.trim();
    }
  }
  let best = "";
  let bestWidth = -1;
  for (const key of Object.keys(images)) {
    const entry = images[key];
    if (!entry || typeof entry.url !== "string" || !entry.url.trim()) continue;
    const w = Number(entry.width || 0);
    if (w > bestWidth) {
      bestWidth = w;
      best = entry.url.trim();
    }
  }
  return best;
}

async function fetchMultiPinShare(mpsId: string, sourceUrl: string): Promise<MultiPinResult | null> {
  try {
    const sourcePath = `/multi-pin-share/${mpsId}/`;
    const dataPayload = JSON.stringify({
      options: {
        url: `/v3/multipinshare/${mpsId}/`,
        data: {
          fields: "multipinshare.owner(),multipinshare.pins(),pin.images,pin.title,pin.grid_title,user.username,user.full_name",
        },
      },
      context: {},
    });
    const apiUrl = `https://www.pinterest.com/resource/ApiResource/get/?source_url=${encodeURIComponent(sourcePath)}&data=${encodeURIComponent(dataPayload)}`;
    const response = await host_fetch(apiUrl, {
      timeoutMs: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Pinterest-AppState": "active",
        "X-Pinterest-PWS-Handler": "www/multi-pin-share/[id].js",
        "X-Pinterest-Source-Url": sourcePath,
        "Referer": `https://www.pinterest.com${sourcePath}`,
      },
    });
    if (!response.ok) return null;
    const json = await response.json() as {
      resource_response?: {
        data?: {
          pins?: Array<{ images?: PinImagesMap; grid_title?: string; title?: string }>;
          owner?: { full_name?: string; username?: string };
        };
      };
    };
    const data = json?.resource_response?.data;
    const pins = data && Array.isArray(data.pins) ? data.pins : [];
    if (pins.length === 0) return null;

    const items: MultiPinItem[] = [];
    for (const p of pins) {
      const imgUrl = pickPinImagesBestUrl(p?.images);
      if (!imgUrl) continue;
      const candidates = pinterestImageCandidates(imgUrl);
      const name = String((p && (p.grid_title || p.title)) || "").trim();
      items.push({
        url: candidates[0] || imgUrl,
        candidates,
        sourceUrl,
        name,
        tags: ["pinterest"],
      });
    }
    if (items.length === 0) return null;

    const owner = data?.owner || {};
    const ownerName = String(owner.full_name || owner.username || "").trim();
    const shortId = mpsId.slice(-6);
    const folderName = ownerName
      ? `Pinterest · ${ownerName} (${shortId})`
      : `Pinterest 集合 (${shortId})`;

    if (typeof host !== "undefined" && typeof host.log === "function") {
      host.log("info", "pinterest.multipin", `mpsId=${mpsId} pins=${items.length} folder=${folderName}`);
    }
    return {
      url: items[0].url,
      folderName,
      sourceUrl,
      tags: ["pinterest"],
      items,
    };
  } catch (err) {
    if (typeof host !== "undefined" && typeof host.log === "function") {
      host.log("warn", "pinterest.multipin", `${mpsId} ${String(err)}`);
    }
    return null;
  }
}

async function fetchPinImage(pageUrl: string, options: FetchOptions = {}): Promise<FetchPinResult | null> {
  try {
    const response = await host_fetch(pageUrl, options);
    if (!response.ok) {
      if (typeof host !== "undefined" && typeof host.log === "function") {
        host.log("warn", "pinterest.page", `${pageUrl} status=${response.status}`);
      }
      return null;
    }
    const finalUrl = response.url || pageUrl;
    const mpsMatch = finalUrl.match(MULTI_PIN_SHARE_RE);
    if (mpsMatch) {
      const multi = await fetchMultiPinShare(mpsMatch[1], pageUrl);
      if (multi) return { multi };
    }
    const html = await response.text();
    const imageUrl = extractImageFromHtml(html);
    if (!imageUrl) {
      if (typeof host !== "undefined" && typeof host.log === "function") {
        host.log("warn", "pinterest.page", `${pageUrl} no anchored image`);
      }
      return null;
    }
    return { pageUrl: finalUrl, imageUrl };
  } catch (err) {
    if (typeof host !== "undefined" && typeof host.log === "function") {
      host.log("warn", "pinterest.page", `${pageUrl} ${String(err)}`);
    }
    return null;
  }
}

export async function resolveUrl({ url }: ResolveUrlInput): Promise<PluginUrlResolution | null> {
  const input = parseInput(url);
  if (!input) return null;

  if (input.kind === "image") {
    return {
      url: input.url,
      candidates: pinterestImageCandidates(input.url),
      sourceUrl: input.url,
      tags: ["pinterest"],
    };
  }

  const pin = input.pin;
  if (typeof host !== "undefined" && typeof host.log === "function") {
    host.log("info", "pinterest.match", pin.host);
  }

  if (pin.mpsId) {
    const multi = await fetchMultiPinShare(pin.mpsId, pin.sourceUrl);
    if (multi) return multi;
  }

  const pageUrls = [pin.sourceUrl];
  if (pin.canonicalUrl && pin.canonicalUrl !== pin.sourceUrl) pageUrls.push(pin.canonicalUrl);

  for (const pageUrl of pageUrls) {
    // Keep direct attempts short when the main domain is blackholed.
    const resolved = await fetchPinImage(pageUrl, { timeoutMs: 8000 });
    if (resolved) {
      if (resolved.multi) return resolved.multi;
      return {
        url: resolved.imageUrl,
        candidates: pinterestImageCandidates(resolved.imageUrl),
        sourceUrl: pin.sourceUrl,
        tags: ["pinterest"],
      };
    }
  }

  if (pin.id) {
    // Original PR fallback: Fastly-fronted regional domains. The Host header
    // asks the front to serve the canonical Pinterest site.
    for (const frontHost of ["pinterest.ru", "pinterest.co.kr"]) {
      const resolved = await fetchPinImage(
        `https://${frontHost}/pin/${pin.id}/`,
        { headers: { Host: "www.pinterest.com" }, timeoutMs: 15000 },
      );
      if (resolved && !resolved.multi) {
        return {
          url: resolved.imageUrl,
          candidates: pinterestImageCandidates(resolved.imageUrl),
          sourceUrl: pin.sourceUrl,
          tags: ["pinterest"],
        };
      }
    }
  }

  return null;
}

export async function inspect({ item }: InspectInput): Promise<InspectResult | null> {
  const source = item && (item.url || item.originalUrl);
  if (!source) return null;
  let hostname = "";
  try { hostname = new URL(source).hostname.toLowerCase(); } catch { return null; }
  if (!PINTEREST_HOST_RE.test(hostname) && hostname !== "pin.it") return null;
  return {
    sections: [{
      title: "Pinterest",
      rows: [
        { label: "Source", value: source, copyable: true },
        { label: "Status", value: "Resolved image available" },
      ],
      textBlocks: [],
    }],
  };
}

export async function actions({ items }: PluginActionContext): Promise<PluginAction[]> {
  if (!items || items.length === 0) return [];
  if (typeof host === "undefined" || typeof host.platformOpen !== "function") return [];
  return [{ id: "open-source", title: "Open Pinterest page", icon: "external" }];
}

export async function runAction(
  { id, item, items }: PluginActionContext & { id: string },
): Promise<{ ok: boolean } | null> {
  if (id !== "open-source") return null;
  const target = (item && (item.url || item.originalUrl)) || (items && items[0] && (items[0].url || items[0].originalUrl));
  if (!target) return { ok: false };
  if (typeof host !== "undefined" && typeof host.platformOpen === "function") host.platformOpen(target);
  return { ok: true };
}
