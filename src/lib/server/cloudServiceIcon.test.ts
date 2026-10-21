import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import sharp from "sharp";

const { uploadImage } = vi.hoisted(() => ({ uploadImage: vi.fn() }));
vi.mock("axios", () => ({ default: vi.fn() }));
vi.mock("./controllers/imageController.js", () => ({ uploadImage }));
const mockedAxios = vi.mocked(axios);

import { FetchCloudServiceIcon, FindIconLinks, IconPageFor, PngFromIco, ToStorableImage } from "./cloudServiceIcon";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reply = (status: number, data: unknown) => ({ status, data }) as any;
const png = (size: number) =>
  sharp({ create: { width: size, height: size, channels: 4, background: "#0052cc" } })
    .png()
    .toBuffer();

/** A one-entry .ico holding the given PNG. */
function ico(pngData: Buffer, width = 32): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width;
  header[7] = width;
  header.writeUInt32LE(pngData.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngData]);
}

beforeEach(() => {
  mockedAxios.mockReset();
  uploadImage.mockReset();
  uploadImage.mockResolvedValue({ url: "/assets/images/abc.png" });
});

describe("FindIconLinks", () => {
  it("puts touch icons and larger icons first and ends with /favicon.ico", () => {
    const html = `
      <link rel="icon" href="/small.png" sizes="16x16" type="image/png">
      <link rel='apple-touch-icon' href='https://cdn.example.com/touch.png' sizes='180x180'>
      <link href="/big.png" rel="icon" sizes="192x192">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="stylesheet" href="/style.css">`;
    expect(FindIconLinks(html, "https://status.example.com/")).toEqual([
      "https://cdn.example.com/touch.png",
      "https://status.example.com/big.png",
      "https://status.example.com/small.png",
      "https://status.example.com/favicon.ico",
    ]);
  });

  it("falls back to /favicon.ico when the page declares no icon", () => {
    expect(FindIconLinks("<html></html>", "https://teams.microsoft.com/x")).toEqual([
      "https://teams.microsoft.com/favicon.ico",
    ]);
  });
});

describe("image conversion", () => {
  it("takes the PNG out of an .ico file", async () => {
    const inner = await png(32);
    expect(PngFromIco(ico(inner))?.equals(inner)).toBe(true);
    expect(PngFromIco(Buffer.from("not an icon"))).toBeNull();
  });

  it("renders SVG to PNG and keeps PNG as is", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect((await ToStorableImage(svg))?.mimeType).toBe("image/png");
    const p = await png(16);
    expect(await ToStorableImage(p)).toEqual({ data: p, mimeType: "image/png" });
    expect(await ToStorableImage(Buffer.from("<html>nope</html>"))).toBeNull();
  });
});

describe("IconPageFor", () => {
  it("uses the status page for Statuspage services and the web app for Microsoft 365", () => {
    expect(IconPageFor({ provider: "confluence" })).toBe("https://confluence.status.atlassian.com");
    expect(IconPageFor({ provider: "statuspage-custom", statuspageUrl: "https://status.acme.test/" })).toBe(
      "https://status.acme.test",
    );
    expect(IconPageFor({ provider: "m365-teams" })).toBe("https://teams.microsoft.com");
    expect(IconPageFor({ provider: "m365-custom" })).toBe("");
  });
});

describe("FetchCloudServiceIcon", () => {
  it("stores the page's best icon and returns its URL", async () => {
    const icon = await png(180);
    mockedAxios.mockImplementation(async (url) => {
      if (url === "https://jira-software.status.atlassian.com")
        return reply(200, Buffer.from('<link rel="apple-touch-icon" href="/touch.png">'));
      if (url === "https://jira-software.status.atlassian.com/touch.png") return reply(200, icon);
      return reply(404, Buffer.alloc(0));
    });

    expect(await FetchCloudServiceIcon({ provider: "jira" })).toBe("/assets/images/abc.png");
    expect(uploadImage).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png", maxWidth: 128, maxHeight: 128, fileName: "cloud-icon-jira" }),
    );
  });

  it("tries the next candidate when one is broken, down to /favicon.ico", async () => {
    const inner = await png(32);
    mockedAxios.mockImplementation(async (url) => {
      if (url === "https://teams.microsoft.com") return reply(200, Buffer.from('<link rel="icon" href="/broken.png">'));
      if (url === "https://teams.microsoft.com/broken.png") return reply(200, Buffer.from("<html>error</html>"));
      if (url === "https://teams.microsoft.com/favicon.ico") return reply(200, ico(inner));
      return reply(404, Buffer.alloc(0));
    });

    expect(await FetchCloudServiceIcon({ provider: "m365-teams" })).toBe("/assets/images/abc.png");
    expect(uploadImage).toHaveBeenCalledOnce();
  });

  it("explains when no icon can be found", async () => {
    mockedAxios.mockResolvedValue(reply(404, Buffer.alloc(0)));
    await expect(FetchCloudServiceIcon({ provider: "jira" })).rejects.toThrow(
      "Could not find a usable icon on jira-software.status.atlassian.com",
    );
    await expect(FetchCloudServiceIcon({ provider: "m365-custom" })).rejects.toThrow("no known icon source");
  });
});
