import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knex } from "knex";

// TEST_DATABASE_URL=postgresql://… or mysql://… runs this file on that engine instead of in-memory
// SQLite. It empties the site_data table: use a throwaway database.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
vi.mock("$lib/server/db/db", async () => {
  const { default: DbImpl } = await import("$lib/server/db/dbimpl");
  if (process.env.TEST_DATABASE_URL) {
    const { default: knexOb } = await import("../../../../knexfile");
    return { default: new DbImpl(knexOb) };
  }
  return {
    default: new DbImpl({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }),
  };
});
vi.mock("axios", () => ({ default: vi.fn() }));

import axios from "axios";
import db from "$lib/server/db/db";
import {
  ClearM365SettingsCache,
  GetM365SettingsView,
  GetM365SharedConnection,
  SaveM365Settings,
  TestM365Settings,
} from "./m365SettingsController";
import CloudServiceCall from "../services/cloudServiceCall";
import { ClearCloudProviderCache } from "../cloudProviderClient";

const mockedAxios = vi.mocked(axios);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;
const TENANT = "3f2a9c71-8b4d-4e2a-9f10-6c5d7e8a1b2c";
const CLIENT = "a7c41e09-2f3b-4d8a-b615-0e9f2c7d4a3b";
const token = reply(200, { access_token: "tok", expires_in: 3600 });
const health = reply(200, {
  value: [
    { id: "OrgLiveID", service: "Microsoft Entra", status: "serviceOperational" },
    { id: "microsoftteams", service: "Microsoft Teams", status: "serviceDegradation" },
  ],
});

const migrations = import.meta.glob<Knex.Migration>("/migrations/*.ts", { eager: true });
const knex = (db as unknown as { knex: Knex }).knex;

beforeAll(async () => {
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => Object.keys(migrations).sort(),
      getMigrationName: (name: string) => name.slice("/migrations/".length),
      getMigration: async (name: string) => migrations[name],
    },
  });
});

beforeEach(async () => {
  await knex("site_data").del();
  mockedAxios.mockReset();
  ClearM365SettingsCache();
  ClearCloudProviderCache();
});
afterEach(() => {
  delete process.env.M365_TENANT_ID;
  delete process.env.M365_CLIENT_ID;
  delete process.env.M365_CLIENT_SECRET;
});

describe("Microsoft 365 settings page", () => {
  it("saves the ids and the secret, and never shows the secret again", async () => {
    const view = await SaveM365Settings({ tenantId: ` ${TENANT} `, clientId: CLIENT, clientSecret: "kP28Q~a1Bc" });
    expect(view).toMatchObject({ tenantId: TENANT, clientId: CLIENT, hasSecret: true });
    expect(JSON.stringify(view)).not.toContain("kP28Q");
    expect(await GetM365SharedConnection()).toEqual({ tenantId: TENANT, clientId: CLIENT, clientSecret: "kP28Q~a1Bc" });
  });

  it("keeps the saved secret when the field is left empty, and removes it on request", async () => {
    await SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, clientSecret: "kP28Q~a1Bc" });
    await SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, clientSecret: "" });
    expect((await GetM365SharedConnection()).clientSecret).toBe("kP28Q~a1Bc");
    const removed = await SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, removeSecret: true });
    expect(removed.hasSecret).toBe(false);
  });

  it("refuses ids in the wrong place and a Secret ID instead of the Value", async () => {
    await expect(SaveM365Settings({ tenantId: "my tenant", clientId: CLIENT })).rejects.toThrow("Tenant ID");
    await expect(SaveM365Settings({ tenantId: TENANT, clientId: "Statuspage" })).rejects.toThrow("Client ID");
    await expect(SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, clientSecret: CLIENT })).rejects.toThrow(
      "Secret ID",
    );
    expect((await SaveM365Settings({ tenantId: "band.ch", clientId: CLIENT })).tenantId).toBe("band.ch");
  });

  it("shows which values the environment provides", async () => {
    process.env.M365_CLIENT_SECRET = "from-env";
    expect((await GetM365SettingsView()).fromEnvironment).toEqual({
      tenantId: false,
      clientId: false,
      clientSecret: true,
    });
  });

  it("tests the connection and lists the tenant's services", async () => {
    await SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, clientSecret: "kP28Q~a1Bc" });
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);
    expect(await TestM365Settings()).toEqual({ services: ["Microsoft Entra", "Microsoft Teams"] });
    const tokenCall = mockedAxios.mock.calls[0] as [string, { data: string }];
    expect(tokenCall[0]).toContain(TENANT);
    expect(new URLSearchParams(tokenCall[1].data).get("client_secret")).toBe("kP28Q~a1Bc");
  });

  it("says what is missing when nothing is set", async () => {
    await expect(TestM365Settings()).rejects.toThrow("Tenant ID, Client ID, Client secret");
  });
});

describe("Microsoft 365 monitors use the settings page", () => {
  const monitor = (type_data: Record<string, unknown>) =>
    new CloudServiceCall({ tag: "entra", type_data: { provider: "m365-entra", ...type_data } }).execute();

  it("signs in with the settings page's connection when the monitor's fields are empty", async () => {
    await SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, clientSecret: "kP28Q~a1Bc" });
    process.env.M365_CLIENT_SECRET = "older-env-secret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);
    expect(await monitor({})).toMatchObject({ status: "UP", raw_status: "serviceOperational" });
    const tokenCall = mockedAxios.mock.calls[0] as [string, { data: string }];
    expect(new URLSearchParams(tokenCall[1].data).get("client_secret")).toBe("kP28Q~a1Bc");
  });

  it("lets a monitor's own fields win over the settings page", async () => {
    await SaveM365Settings({ tenantId: TENANT, clientId: CLIENT, clientSecret: "kP28Q~a1Bc" });
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);
    await monitor({ clientSecret: "own~secret" });
    const tokenCall = mockedAxios.mock.calls[0] as [string, { data: string }];
    expect(new URLSearchParams(tokenCall[1].data).get("client_secret")).toBe("own~secret");
  });

  it("falls back to the environment when the settings page is empty", async () => {
    process.env.M365_TENANT_ID = TENANT;
    process.env.M365_CLIENT_ID = CLIENT;
    process.env.M365_CLIENT_SECRET = "env~secret";
    mockedAxios.mockResolvedValueOnce(token).mockResolvedValueOnce(health);
    expect((await monitor({})).status).toBe("UP");
  });
});
