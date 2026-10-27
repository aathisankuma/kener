// Reads Jira Service Management through its service desk API, signed in as a customer account
// (e.g. status@company.com). A customer sees only the requests it was added to as a request
// participant, and never internal comments: Jira itself limits what Kener can read.
//
//   JSM_BASE_URL   https://company.atlassian.net, or the Data Center address
//   JSM_EMAIL      Atlassian Cloud: the account's email; leave empty for a Data Center token
//   JSM_API_TOKEN  Cloud: API token of that account; Data Center: personal access token
import axios, { type AxiosResponse } from "axios";
import { CloudHttpOptions } from "./cloudProviderClient.js";

export interface JsmTicket {
  key: string;
  summary: string;
  /** The ticket's status as named in Jira, e.g. "Warten auf Lieferant". */
  status: string;
  /** Jira's fixed status category: NEW, INDETERMINATE or DONE. */
  statusCategory: string;
  /** UTC seconds. */
  createdAt: number;
  url: string | null;
}

export interface JsmComment {
  id: string;
  body: string;
  /** UTC seconds. */
  createdAt: number;
}

const TICKET_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const PAGE = 50;
const MAX_PAGES = 10;

/** A ticket key from a key or a ticket link, e.g. ".../browse/IT-1234" → "IT-1234"; "" if none. */
export function ParseTicketKey(input: string): string {
  const text = String(input || "").trim();
  if (TICKET_KEY.test(text.toUpperCase())) return text.toUpperCase();
  const match = text.match(/(?:browse|portal\/\d+)\/([A-Za-z][A-Za-z0-9_]*-\d+)/);
  return match ? match[1].toUpperCase() : "";
}

export function JsmConfigured(): boolean {
  return !!(process.env.JSM_BASE_URL || "").trim() && !!(process.env.JSM_API_TOKEN || "").trim();
}

function connection(): { base: string; authorization: string } {
  const base = (process.env.JSM_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.JSM_API_TOKEN || "").trim();
  const email = (process.env.JSM_EMAIL || "").trim();
  if (!/^https?:\/\//i.test(base) || !token) {
    throw new Error("Jira Service Management is not set up: set JSM_BASE_URL and JSM_API_TOKEN");
  }
  // Atlassian Cloud signs in with email and API token; Data Center with a personal access token.
  const authorization = email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}`;
  return { base, authorization };
}

async function get(path: string, timeout = 15000): Promise<AxiosResponse> {
  const { base, authorization } = connection();
  const options = CloudHttpOptions(timeout);
  const response: AxiosResponse = await axios(`${base}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: authorization },
  });
  if (response.status === 401) {
    throw new Error("Jira Service Management refused the sign-in (HTTP 401): check JSM_EMAIL and JSM_API_TOKEN");
  }
  if (response.status === 403 || response.status === 404) {
    throw new Error(
      `Kener cannot see this ticket (HTTP ${response.status}): add the Kener account as request participant`,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Jira Service Management answered HTTP ${response.status}`);
  }
  return response;
}

const seconds = (date: unknown): number => {
  const millis = Number((date as { epochMillis?: unknown })?.epochMillis);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : 0;
};

export function ToJsmTicket(raw: Record<string, unknown>): JsmTicket {
  const fields = Array.isArray(raw.requestFieldValues)
    ? (raw.requestFieldValues as Array<{ fieldId?: string; value?: unknown }>)
    : [];
  const summary = fields.find((f) => f.fieldId === "summary")?.value;
  const status = (raw.currentStatus ?? {}) as { status?: string; statusCategory?: string };
  return {
    key: String(raw.issueKey ?? ""),
    summary: typeof summary === "string" && summary.trim() ? summary.trim() : String(raw.issueKey ?? ""),
    status: String(status.status ?? ""),
    statusCategory: String(status.statusCategory ?? "").toUpperCase(),
    createdAt: seconds(raw.createdDate),
    url: (raw._links as { web?: string } | undefined)?.web ?? null,
  };
}

async function allPages(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const join = path.includes("?") ? "&" : "?";
    const body = (await get(`${path}${join}start=${page * PAGE}&limit=${PAGE}`)).data;
    const values = Array.isArray(body?.values) ? body.values : [];
    out.push(...values);
    if (body?.isLastPage !== false || values.length === 0) break;
  }
  return out;
}

/** Tickets the Kener account was added to as request participant, newest first. */
export async function JsmListSharedTickets(): Promise<JsmTicket[]> {
  const raw = await allPages(
    "/rest/servicedeskapi/request?requestOwnership=PARTICIPATED_REQUESTS&requestStatus=ALL_REQUESTS",
  );
  return raw
    .map(ToJsmTicket)
    .filter((t) => t.key)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function JsmGetTicket(key: string): Promise<JsmTicket> {
  return ToJsmTicket((await get(`/rest/servicedeskapi/request/${encodeURIComponent(key)}`)).data);
}

/**
 * The ticket's replies to customers, oldest first. Internal comments are asked away, and a
 * customer account never receives them; any comment not marked public is dropped as well.
 */
export async function JsmGetPublicComments(key: string): Promise<JsmComment[]> {
  const raw = await allPages(
    `/rest/servicedeskapi/request/${encodeURIComponent(key)}/comment?public=true&internal=false`,
  );
  return raw
    .filter((c) => c.public === true)
    .map((c) => ({ id: String(c.id ?? ""), body: String(c.body ?? "").trim(), createdAt: seconds(c.created) }))
    .filter((c) => c.id && c.body)
    .sort((a, b) => a.createdAt - b.createdAt || Number(a.id) - Number(b.id));
}

/** Jira's status category → Kener incident state. */
export function IncidentStateFor(statusCategory: string): "INVESTIGATING" | "IDENTIFIED" | "RESOLVED" {
  switch (statusCategory.toUpperCase()) {
    case "DONE":
      return "RESOLVED";
    case "INDETERMINATE":
      return "IDENTIFIED";
    default:
      return "INVESTIGATING";
  }
}
