import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFromRequest: vi.fn(),
}));

vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.sessionFromRequest }));

import { GET } from "./route";

describe("image proxy", () => {
  beforeEach(() => {
    mocks.sessionFromRequest.mockResolvedValue({ userId: "user-1" });
    vi.restoreAllMocks();
  });

  it("does not follow upstream redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("redirect mode is set to error"));
    const request = new NextRequest(
      "http://localhost/api/v1/image-proxy?url=https%3A%2F%2Fir.ozone.ru%2Fs3%2Fimage.jpg",
    );

    const response = await GET(request);

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://ir.ozone.ru/s3/image.jpg"),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects active SVG content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<svg><script>alert(1)</script></svg>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const request = new NextRequest(
      "http://localhost/api/v1/image-proxy?url=https%3A%2F%2Fir.ozone.ru%2Fs3%2Fimage.svg",
    );

    expect((await GET(request)).status).toBe(502);
  });
});
