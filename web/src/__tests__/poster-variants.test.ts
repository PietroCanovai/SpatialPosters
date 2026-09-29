import { describe, it, expect } from "vitest"
import { applyPosterVariant, storeVariant, MAX_POSTER_VARIANTS, type PosterEditorSnapshot } from "@/lib/poster-variants"
import type { Mapping } from "@/lib/types"

const base: Mapping = {
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/a.jpg", logoPath: "/logo1.png",
  originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  posterScale: 100, posterOffsetX: 0, posterOffsetY: 0, accentColor: null,
  logoScale: 70, logoOffsetX: 0, logoOffsetY: 0, blurEnabled: true, gradientHeight: 30,
}

const snap = (over: Partial<PosterEditorSnapshot> = {}): PosterEditorSnapshot => ({
  posterScale: 100, posterOffsetX: 0, posterOffsetY: 0, accentColor: null, gradientHeight: 30,
  blurEnabled: true, blurIntensity: 5, blurFade: 60, blurDarkness: 40,
  logoPath: "/logo1.png", logoScale: 70, logoOffsetX: 0, logoOffsetY: 0,
  ...over,
})

describe("poster variants", () => {
  it("keeps separate settings per poster and per poster+logo pair", () => {
    let v = storeVariant({}, "/a.jpg", snap({ posterScale: 200, accentColor: "#ff0000", logoPath: "/logo1.png", logoScale: 50, logoOffsetY: -20 }))
    v = storeVariant(v, "/b.jpg", snap({ posterScale: 130, blurEnabled: false, logoPath: "/logo2.png", logoScale: 90 }))
    // the same logo placed differently on poster A
    v = storeVariant(v, "/a.jpg", snap({ posterScale: 200, accentColor: "#ff0000", logoPath: "/logo2.png", logoScale: 40 }))

    expect(v["/a.jpg"].posterScale).toBe(200)
    expect(v["/b.jpg"].posterScale).toBe(130)
    expect(v["/a.jpg"].logoPath).toBe("/logo2.png")
    expect(v["/a.jpg"].logos).toEqual({
      "/logo1.png": { logoScale: 50, logoOffsetX: 0, logoOffsetY: -20 },
      "/logo2.png": { logoScale: 40, logoOffsetX: 0, logoOffsetY: 0 },
    })
    expect(v["/b.jpg"].logos).toEqual({ "/logo2.png": { logoScale: 90, logoOffsetX: 0, logoOffsetY: 0 } })
  })

  it("renders each poster with its own configuration", () => {
    const variants = storeVariant(
      storeVariant({}, "/a.jpg", snap({ posterScale: 200, accentColor: "#ff0000", logoPath: "/logo1.png", logoScale: 50 })),
      "/b.jpg", snap({ posterScale: 130, blurEnabled: false, logoPath: null }),
    )
    const m: Mapping = { ...base, variants }
    const a = applyPosterVariant(m, "/a.jpg", "/logo1.png")!
    expect([a.posterScale, a.accentColor, a.logoScale, a.logoPath]).toEqual([200, "#ff0000", 50, "/logo1.png"])
    const b = applyPosterVariant(m, "/b.jpg", null)!
    expect([b.posterScale, b.blurEnabled, b.logoPath]).toEqual([130, false, null])
    // a poster without a variant uses the top-level design
    expect(applyPosterVariant(m, "/c.jpg", "/logo1.png")).toBe(m)
  })

  it("a logo without its own placement on that poster keeps the top-level placement", () => {
    const m: Mapping = { ...base, variants: storeVariant({}, "/a.jpg", snap({ logoPath: "/logo1.png", logoScale: 55 })) }
    expect(applyPosterVariant(m, "/a.jpg", "/other.png")!.logoScale).toBe(70)
  })

  it("caps the number of stored variants but always keeps the one being saved", () => {
    let v = {}
    for (let i = 0; i < MAX_POSTER_VARIANTS + 5; i++) v = storeVariant(v, `/p${i}.jpg`, snap())
    const keys = Object.keys(v)
    expect(keys).toHaveLength(MAX_POSTER_VARIANTS)
    expect(keys).toContain(`/p${MAX_POSTER_VARIANTS + 4}.jpg`)
    expect(keys).not.toContain("/p0.jpg")
  })
})
