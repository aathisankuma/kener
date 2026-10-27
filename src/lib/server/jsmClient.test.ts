import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  IncidentStateFor,
  JsmConfigured,
  JsmGetPublicComments,
  JsmGetTicket,
  JsmListSharedTickets,
  ParseTicketKey,
} from "./jsmClient";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;

const request = (key: string, summary: string, statusCategory = "NEW", created = 1793000000000) => ({
  issueKey: key,
  requestFieldValues: [
    { fieldId: "summary", label: "Summary", value: summary },
    { fieldId: "description", label: "Description", value: "Hallo, mein Drucker…" },
  ],
  currentStatus: { status: statusCategory === "DONE" ? "Erledigt" : "Offen", statusCategory },
  createdDate: { epochMillis: created, iso8601: "2026-10-26T08:13:20+0000" },
  _links: { web: `https://jsm.example.test/servicedesk/customer/portal/1/${key}` },
});

beforeEach(() => {
  mockedAxios.mockReset();
  process.env.JSM_BASE_URL = "https://jsm.example.test/";
  process.env.JSM_EMAIL = "status@example.test";
  process.env.JSM_API_TOKEN = "token-123";
});
afterEach(() => {
  delete process.env.JSM_BASE_URL;
  delete process.env.JSM_EMAIL;
  delete process.env.JSM_API_TOKEN;
});

describe("setup", () => {
  it("reads a ticket key from a key or a link", () => {
    expect(ParseTicketKey("it-1234")).toBe("IT-1234");
    expect(ParseTicketKey("https://jsm.example.test/browse/IT-1234")).toBe("IT-1234");
    expect(ParseTicketKey("https://jsm.example.test/servicedesk/customer/portal/1/SUP-7")).toBe("SUP-7");
    expect(ParseTicketKey("Drucker kaputt")).toBe("");
  });

  it("knows whether it is set up", () => {
    expect(JsmConfigured()).toBe(true);
    delete process.env.JSM_API_TOKEN;
    expect(JsmConfigured()).toBe(false);
  });

  it("signs in with email and token on Cloud, with a bearer token on Data Center", async () => {
    mockedAxios.mockResolvedValue(reply(200, request("IT-1", "Drucker")));
    await JsmGetTicket("IT-1");
    const cloud = mockedAxios.mock.calls[0];
    expect(cloud[0]).toBe("https://jsm.example.test/rest/servicedeskapi/request/IT-1");
    expect((cloud[1] as { headers: Record<string, string> }).headers.Authorization).toBe(
      `Basic ${Buffer.from("status@example.test:token-123").toString("base64")}`,
    );

    delete process.env.JSM_EMAIL;
    await JsmGetTicket("IT-1");
    expect((mockedAxios.mock.calls[1][1] as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer token-123",
    );
  });
});

describe("tickets", () => {
  it("lists only the tickets the account takes part in, across pages, newest first", async () => {
    mockedAxios
      .mockResolvedValueOnce(
        reply(200, { isLastPage: false, values: [request("IT-1", "Drucker 2. OG", "NEW", 1000_000)] }),
      )
      .mockResolvedValueOnce(
        reply(200, { isLastPage: true, values: [request("IT-2", "VPN langsam", "DONE", 2000_000)] }),
      );
    const tickets = await JsmListSharedTickets();
    expect(String(mockedAxios.mock.calls[0][0])).toContain("requestOwnership=PARTICIPATED_REQUESTS");
    expect(String(mockedAxios.mock.calls[1][0])).toContain("start=50");
    expect(tickets).toEqual([
      {
        key: "IT-2",
        summary: "VPN langsam",
        status: "Erledigt",
        statusCategory: "DONE",
        createdAt: 2000,
        url: "https://jsm.example.test/servicedesk/customer/portal/1/IT-2",
      },
      expect.objectContaining({ key: "IT-1", summary: "Drucker 2. OG", statusCategory: "NEW" }),
    ]);
  });

  it("explains a ticket Kener may not see and a wrong token", async () => {
    mockedAxios.mockResolvedValueOnce(reply(404, {}));
    await expect(JsmGetTicket("IT-9")).rejects.toThrow("add the Kener account as request participant");
    mockedAxios.mockResolvedValueOnce(reply(401, {}));
    await expect(JsmGetTicket("IT-9")).rejects.toThrow("check JSM_EMAIL and JSM_API_TOKEN");
  });
});

describe("comments", () => {
  it("asks only for public comments and drops anything not marked public", async () => {
    mockedAxios.mockResolvedValueOnce(
      reply(200, {
        isLastPage: true,
        values: [
          { id: "12", body: "Techniker ist vor Ort.", public: true, created: { epochMillis: 3000_000 } },
          { id: "11", body: "Intern: Lieferant anrufen", public: false, created: { epochMillis: 2500_000 } },
          { id: "10", body: "Wir untersuchen das Problem.", public: true, created: { epochMillis: 2000_000 } },
          { id: "13", body: "   ", public: true, created: { epochMillis: 4000_000 } },
        ],
      }),
    );
    const comments = await JsmGetPublicComments("IT-1");
    expect(String(mockedAxios.mock.calls[0][0])).toContain("/request/IT-1/comment?public=true&internal=false");
    expect(comments).toEqual([
      { id: "10", body: "Wir untersuchen das Problem.", createdAt: 2000 },
      { id: "12", body: "Techniker ist vor Ort.", createdAt: 3000 },
    ]);
  });

  it("maps Jira's status categories to incident states", () => {
    expect(IncidentStateFor("NEW")).toBe("INVESTIGATING");
    expect(IncidentStateFor("indeterminate")).toBe("IDENTIFIED");
    expect(IncidentStateFor("DONE")).toBe("RESOLVED");
    expect(IncidentStateFor("UNDEFINED")).toBe("INVESTIGATING");
  });
});
