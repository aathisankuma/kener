import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { ListCloudComponents } from "./cloudComponents";
import { ABACUS_COMPONENTS } from "./instatusFixture";

vi.mock("axios", () => ({ default: vi.fn() }));
const mockedAxios = vi.mocked(axios);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;

beforeEach(() => mockedAxios.mockReset());

describe("ListCloudComponents", () => {
  it("lists an Instatus page's components, naming repeated ones by group", async () => {
    mockedAxios.mockResolvedValueOnce(reply(200, ABACUS_COMPONENTS));
    const names = await ListCloudComponents({ provider: "abacus-cloud" });
    expect(mockedAxios.mock.calls[0][0]).toBe("https://status.abaservices.ch/v3/components.json");
    expect(names).toEqual([
      "Abacus IDP",
      "AbaClock",
      "Deep Cloud Services",
      "Swiss21 Services",
      "AbaBridge / Kundenportal",
      "Service Management (SVM) / Kundenportal",
      "Abacus City",
    ]);
  });

  it("lists a Statuspage's components without groups, in page order", async () => {
    mockedAxios.mockResolvedValueOnce(
      reply(200, {
        components: [
          { name: "Search", position: 2 },
          { name: "Core", group: true, position: 0 },
          { name: "Viewing content", position: 1 },
        ],
      }),
    );
    expect(await ListCloudComponents({ provider: "jira" })).toEqual(["Viewing content", "Search"]);
  });

  it("refuses Microsoft 365 and a missing URL", async () => {
    await expect(ListCloudComponents({ provider: "m365-teams" })).rejects.toThrow("no components");
    await expect(ListCloudComponents({ provider: "instatus-custom", statuspageUrl: "" })).rejects.toThrow(
      "URL is missing",
    );
  });
});
