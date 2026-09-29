import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchPublicUrl, isPrivateHost, resolveAndCheckBlocked, SsrfBlockedError } from "@/lib/safe-fetch"

describe("safe-fetch SSRF guard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("blocks loopback, private, CGNAT and link-local literals", () => {
    for (const h of ["127.0.0.2", "0.0.0.0", "10.1.2.3", "192.168.1.1", "172.20.0.1", "100.64.0.1", "169.254.169.254", "[::1]", "foo.localhost"]) {
      expect(isPrivateHost(h), h).toBe(true)
    }
    expect(isPrivateHost("image.tmdb.org")).toBe(false)
    expect(isPrivateHost("fcbarcelona.com")).toBe(false)
  })

  it("normalises decimal/hex IPv4 forms via the URL parser", async () => {
    expect(await resolveAndCheckBlocked("http://2130706433/")).toBe(true)
    expect(await resolveAndCheckBlocked("http://0x7f.1/")).toBe(true)
    expect(await resolveAndCheckBlocked("file:///etc/passwd")).toBe(true)
  })

  it("rejects a private target before fetching", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
    await expect(fetchPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(spy).not.toHaveBeenCalled()
  })

  it("rejects a redirect from a public host to a private one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/api/health" } }),
    )
    // 93.184.215.14: literal public IP, so no DNS lookup is needed
    await expect(fetchPublicUrl("http://93.184.215.14/img.jpg")).rejects.toBeInstanceOf(SsrfBlockedError)
  })
})
