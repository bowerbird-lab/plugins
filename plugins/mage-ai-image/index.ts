import type {
  PluginAction,
  PluginActionContext,
  PluginItem,
} from "@bowerbird/plugin-sdk";

const MAGE_API_BASE = "https://api.mage.space/v1";
const SUPPORTED_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

interface MageModelOption {
  id: string;
  name: string;
  modelId?: string;
  gems?: number;
  aspectRatios?: string[];
  description?: string;
}

interface MageArchitectureRecord {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  gems?: number;
  base_config?: Record<string, unknown>;
  image_inputs?: {
    references?: {
      field?: string;
      additional_field?: string;
    };
  };
  options?: Record<string, unknown>;
}

const FALLBACK_EDIT_MODELS: MageModelOption[] = [
  { id: "flux2", name: "Flux 2", modelId: "flux2-dev", gems: 40 },
  { id: "gpt_image_2", name: "GPT Image 2", gems: 40 },
  { id: "mango", name: "Mango", gems: 40 },
  { id: "nano_banana_v2", name: "Nano Banana 2", gems: 40 },
  { id: "seedream", name: "Seedream", gems: 40 },
  { id: "guava", name: "Guava", gems: 40 },
];

function isImageItem(item?: PluginItem): boolean {
  if (!item) return false;
  const ext = (item.extension || "").replace(/^\./, "").toLowerCase();
  if (SUPPORTED_EXTS.has(ext)) return true;
  const mime = (item.mimeType || "").toLowerCase();
  return mime.startsWith("image/");
}

function getApiKey(): string {
  return (host.settings.get("apiKey") || "").trim();
}

function getDefaultArchitecture(): string {
  const configured = (host.settings.get("defaultArchitecture", "flux2") || "").trim();
  return configured || "flux2";
}

function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new Error("Mage API Key is not configured. Please set it in Settings -> Plugins -> Mage AI Image.");
  }
  return key;
}

function authHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    ...(extra || {}),
  };
}

function makeIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `bb-mage-${Date.now()}-${rand}`;
}

function extractApiError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: string; message?: string; reason?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string" && parsed.error) {
      return `Mage API (${status}): ${parsed.error}`;
    }
    if (parsed.error && typeof parsed.error === "object") {
      const msg = parsed.error.message || parsed.error.code || bodyText;
      const reason = parsed.error.reason ? ` (${parsed.error.reason})` : "";
      return `Mage API (${status}): ${msg}${reason}`;
    }
    if (parsed.message) {
      return `Mage API (${status}): ${parsed.message}`;
    }
  } catch {
    // Non-JSON response body
  }
  const snippet = bodyText.trim().slice(0, 240);
  return snippet ? `Mage API (${status}): ${snippet}` : `Mage API returned HTTP ${status}`;
}

async function mageJsonRequest<T>(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<T> {
  const res = await host.fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(extractApiError(res.status, text));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function parseMageAccountBalance(account: Record<string, unknown>): number | undefined {
  const candidates = [
    account.gems,
    account.gems_balance,
    account.balance,
    (account.billing as Record<string, unknown> | undefined)?.gems,
    (account.billing as Record<string, unknown> | undefined)?.balance,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      return Math.floor(c);
    }
  }
  return undefined;
}

async function listModels(): Promise<{
  models: MageModelOption[];
  gemsBalance?: number;
  hasApiKey: boolean;
  defaultArchitecture: string;
}> {
  const defaultArchitecture = getDefaultArchitecture();
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      models: FALLBACK_EDIT_MODELS,
      hasApiKey: false,
      defaultArchitecture,
    };
  }

  let models: MageModelOption[] = FALLBACK_EDIT_MODELS;
  try {
    const data = await mageJsonRequest<{ architectures?: MageArchitectureRecord[] }>(
      `${MAGE_API_BASE}/architectures`,
      { method: "GET", headers: authHeaders(apiKey) },
    );
    const list = Array.isArray(data.architectures) ? data.architectures : [];
    const editModels: MageModelOption[] = [];
    for (const arch of list) {
      if (arch.type !== "image" || !arch.id) continue;
      const refField = arch.image_inputs?.references?.field;
      if (!refField) continue;
      const baseModelId =
        typeof arch.base_config?.model_id === "string" ? arch.base_config.model_id : undefined;
      const aspectRatios = Array.isArray(arch.options?.aspect_ratio)
        ? (arch.options?.aspect_ratio as unknown[]).map((v) => String(v))
        : undefined;
      editModels.push({
        id: arch.id,
        name: arch.name || arch.id,
        modelId: baseModelId,
        gems: typeof arch.gems === "number" ? arch.gems : undefined,
        aspectRatios,
        description: arch.description,
      });
    }
    if (editModels.length > 0) {
      models = editModels;
    }
  } catch (err) {
    host.log("warn", "list-models fallback", String(err));
  }

  let gemsBalance: number | undefined;
  try {
    const account = await mageJsonRequest<Record<string, unknown>>(
      `${MAGE_API_BASE}/account`,
      { method: "GET", headers: authHeaders(apiKey) },
    );
    gemsBalance = parseMageAccountBalance(account);
  } catch (err) {
    host.log("warn", "get-account failed", String(err));
  }

  return {
    models,
    gemsBalance,
    hasApiKey: true,
    defaultArchitecture,
  };
}

async function createUpload(params: Record<string, unknown>): Promise<unknown> {
  const apiKey = requireApiKey();
  const contentType = String(params.content_type || "image/png").trim();
  return mageJsonRequest<unknown>(`${MAGE_API_BASE}/uploads`, {
    method: "POST",
    headers: authHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({ content_type: contentType }),
  });
}

async function submitEdit(params: Record<string, unknown>): Promise<unknown> {
  const apiKey = requireApiKey();
  const arch = String(params.architecture || getDefaultArchitecture()).trim();
  const prompt = String(params.prompt || "").trim();
  const image = String(params.image || "").trim();
  if (!arch) throw new Error("architecture is required");
  if (!prompt) throw new Error("prompt is required");
  if (!image) throw new Error("image input is required");

  const body: Record<string, unknown> = {
    prompt,
    image,
  };
  if (typeof params.model_id === "string" && params.model_id.trim()) {
    body.model_id = params.model_id.trim();
  }
  if (typeof params.aspect_ratio === "string" && params.aspect_ratio.trim() && params.aspect_ratio !== "auto") {
    body.aspect_ratio = params.aspect_ratio.trim();
  }
  if (typeof params.seed === "number" && Number.isFinite(params.seed)) {
    body.seed = Math.trunc(params.seed);
  }
  if (Array.isArray(params.additional_images) && params.additional_images.length > 0) {
    body.additional_images = params.additional_images;
  }

  const endpoint = `${MAGE_API_BASE}/${encodeURIComponent(arch)}/generate`;
  host.log("info", "submit-edit", `arch=${arch}`);
  return mageJsonRequest<unknown>(endpoint, {
    method: "POST",
    headers: authHeaders(apiKey, {
      "Content-Type": "application/json",
      "Idempotency-Key": makeIdempotencyKey(),
    }),
    body: JSON.stringify(body),
  });
}

async function pollStatus(params: Record<string, unknown>): Promise<unknown> {
  const apiKey = requireApiKey();
  const rawStatusUrl = typeof params.status_url === "string" ? params.status_url.trim() : "";
  const requestId = typeof params.request_id === "string" ? params.request_id.trim() : "";
  const url =
    rawStatusUrl.startsWith("https://api.mage.space/")
      ? rawStatusUrl
      : requestId
        ? `${MAGE_API_BASE}/requests/${encodeURIComponent(requestId)}/status`
        : "";
  if (!url) throw new Error("status_url or request_id is required");

  return mageJsonRequest<unknown>(url, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
}

async function cancelRequest(params: Record<string, unknown>): Promise<unknown> {
  const apiKey = requireApiKey();
  const rawCancelUrl = typeof params.cancel_url === "string" ? params.cancel_url.trim() : "";
  const requestId = typeof params.request_id === "string" ? params.request_id.trim() : "";
  const url =
    rawCancelUrl.startsWith("https://api.mage.space/")
      ? rawCancelUrl
      : requestId
        ? `${MAGE_API_BASE}/requests/${encodeURIComponent(requestId)}/cancel`
        : "";
  if (!url) throw new Error("cancel_url or request_id is required");

  return mageJsonRequest<unknown>(url, {
    method: "POST",
    headers: authHeaders(apiKey),
  });
}

async function getAccount(): Promise<unknown> {
  const apiKey = requireApiKey();
  return mageJsonRequest<unknown>(`${MAGE_API_BASE}/account`, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
}

export function actions(ctx: PluginActionContext): PluginAction[] {
  const target = ctx.item || (Array.isArray(ctx.items) ? ctx.items[0] : undefined);
  if (!isImageItem(target)) {
    return [];
  }
  return [
    {
      id: "open-editor",
      title: "Mage AI 图片修改",
      icon: "sparkles",
    },
  ];
}

export async function runAction(
  input: PluginActionContext & { id: string } & Record<string, unknown>,
): Promise<unknown> {
  switch (input.id) {
    case "list-models":
      return listModels();
    case "create-upload":
      return createUpload(input);
    case "submit-edit":
      return submitEdit(input);
    case "poll-status":
      return pollStatus(input);
    case "cancel-request":
      return cancelRequest(input);
    case "get-account":
      return getAccount();
    case "open-editor":
      return { ok: true };
    default:
      throw new Error(`Unknown Mage AI action: ${input.id}`);
  }
}
