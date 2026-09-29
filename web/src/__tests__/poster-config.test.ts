import { describe, expect, it } from "vitest"
import {
  resolvePosterRenderConfig, resolvePosterTransform, posterCropWindow, clamp, type PosterRenderConfigInput,
} from "@/lib/poster-config"
import type { Mapping } from "@/lib/types"

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

describe("clamp", () => {
  it("bounds values within [min, max]", () => {
    expect(clamp(150, 5, 100)).toBe(100)
    expect(clamp(-3, 5, 100)).toBe(5)
    expect(clamp(42, 5, 100)).toBe(42)
  })
})

describe("resolvePosterRenderConfig", () => {
  it("uses defaults when nothing is provided", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.badgeStyle).toBe("shadow")
    expect(r.rankingBadgeStyle).toBe("default")
    expect(r.blurEnabled).toBe(true)
    expect(r.blurHeight).toBe(30)
    expect(r.blurIntensity).toBe(5)
    expect(r.blurFade).toBe(60)
    expect(r.blurDarkness).toBe(40)
    expect(r.badgesEnabled).toBe(true)
    expect(r.rankingEnabled).toBe(true)
    expect(r.ribbonSide).toBe("left")
    expect(r.queryExtra).toBeNull()
    expect(r.omitLogo).toBe(false)
    expect([r.posterScale, r.posterOffsetX, r.posterOffsetY]).toEqual([100, 0, 0])
  })

  it("query bs beats mapping and server defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ bs: "pill" }),
      mapping: mapping({ badgeStyle: "colored" }),
      sd: { badgeStyle: "bordo" },
    }))
    expect(r.badgeStyle).toBe("pill")
  })

  it("query rs beats mapping and server defaults", () => {
    // M6: come per bs, la query `rs` vince sul mapping salvato (WYSIWYG).
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "pill" }),
      mapping: mapping({ rankingBadgeStyle: "colored" }),
      sd: { rankingBadgeStyle: "netflix" },
    }))
    expect(r.rankingBadgeStyle).toBe("pill")
  })

  it("mapping rankingBadgeStyle 'default' is treated as no override (falls to sd)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ rankingBadgeStyle: "default" }),
      sd: { rankingBadgeStyle: "bar" },
    }))
    expect(r.rankingBadgeStyle).toBe("bar")
  })

  it("invalid query value does not leak to the renderer (falls back to default rendering)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ bs: "garbage" }),
      sd: { badgeStyle: "vetro" },
    }))
    expect(r.badgeStyle).toBe("shadow")
  })

  it("auto-detect: default ranking style becomes netflix when a rank exists", () => {
    const r = resolvePosterRenderConfig(baseInput({ finalRank: 3 }))
    expect(r.rankingBadgeStyle).toBe("netflix")
  })

  it("auto-detect: explicit netflix reverts to default without a rank", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "netflix" }),
    }))
    expect(r.rankingBadgeStyle).toBe("default")
  })

  it("explicit non-default ranking style is preserved regardless of rank", () => {
    const withRank = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "colored" }),
      finalRank: 7,
    }))
    expect(withRank.rankingBadgeStyle).toBe("colored")
    const withoutRank = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "colored" }),
    }))
    expect(withoutRank.rankingBadgeStyle).toBe("colored")
  })

  it("clamps out-of-range blur/gradient query values", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ blur: "999", bf: "-5", bd: "250", gradHeight: "0" }),
    }))
    expect(r.blurIntensity).toBe(100)
    expect(r.blurFade).toBe(0)
    expect(r.blurDarkness).toBe(100)
    expect(r.blurHeight).toBe(5)
  })

  it("non-finite numeric query falls back to mapping, then default", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ blur: "abc", gradHeight: "1e999" }),
      mapping: mapping({ blurIntensity: 12 }),
    }))
    expect(r.blurIntensity).toBe(12)
    expect(r.blurHeight).toBe(30)
  })

  it("badges=0 and ranking=0 disable badges (query mode)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ badges: "0", ranking: "0", bg: "0", by: "0", br: "0", netLogo: "0" }),
    }))
    expect(r.badgesEnabled).toBe(false)
    expect(r.rankingEnabled).toBe(false)
    expect(r.badgeGenre).toBe(false)
    expect(r.badgeYear).toBe(false)
    expect(r.badgeRating).toBe(false)
    expect(r.qNetLogo).toBe("0")
  })

  it("be=0 disables blur; mapping blurEnabled=false is respected", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ be: "0" }) })).blurEnabled).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ mapping: mapping({ blurEnabled: false }) })).blurEnabled).toBe(false)
  })

  it("ribbonSide: query side=right or side=left wins, then mapping", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ side: "right" }) })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ side: "left" }), mapping: mapping({ ribbonSide: "right" }) })).ribbonSide).toBe("left")
    expect(resolvePosterRenderConfig(baseInput({ mapping: mapping({ ribbonSide: "right" }) })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput()).ribbonSide).toBe("left")
  })

  it("networkLogo: query netLogo wins, then mapping, then sd, then true", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netLogo: "1" }), mapping: mapping({ networkLogo: false }) })).networkLogo).toBe(true)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netLogo: "0" }), mapping: mapping({ networkLogo: true }) })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ mapping: mapping({ networkLogo: false }) })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ sd: { networkLogo: false } })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput()).networkLogo).toBe(true)
  })

  it("queryExtra picks up the extra param", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ extra: "Oggi" }) })).queryExtra).toBe("Oggi")
  })

  it("logo scale/offsets: query overrides mapping", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ scale: "120", ox: "5", oy: "-3" }),
      mapping: mapping({ logoScale: 80, logoOffsetX: 1, logoOffsetY: 2 }),
    }))
    expect(r.logoScale).toBe(120)
    expect(r.logoOffsetX).toBe(5)
    expect(r.logoOffsetY).toBe(-3)
    const r2 = resolvePosterRenderConfig(baseInput({ mapping: mapping({ logoScale: 80, logoOffsetX: 1, logoOffsetY: 2 }) }))
    expect(r2.logoScale).toBe(80)
    expect(r2.logoOffsetX).toBe(1)
    expect(r2.logoOffsetY).toBe(2)
  })

  it("nologo=1 asks the renderer to skip the logo composite", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ nologo: "1" }) })).omitLogo).toBe(true)
  })

  it("badgeGenre/badgeYear/badgeRating default to true", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.badgeGenre).toBe(true)
    expect(r.badgeYear).toBe(true)
    expect(r.badgeRating).toBe(true)
  })

  it("query bg/by/br=0 disables the component and wins over mapping", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ bg: "0", by: "0", br: "0" }),
      mapping: mapping({ badgeGenre: true, badgeYear: true, badgeRating: true }),
    }))
    expect(r.badgeGenre).toBe(false)
    expect(r.badgeYear).toBe(false)
    expect(r.badgeRating).toBe(false)
  })

  it("mapping badge components/manualQuality win over server defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ badgeGenre: false, badgeRating: false, manualQuality: "1080p" }),
      sd: { badgeGenre: true, badgeYear: false, manualQuality: "SD" },
    }))
    expect(r.badgeGenre).toBe(false)
    expect(r.badgeYear).toBe(false)
    expect(r.badgeRating).toBe(false)
    expect(r.manualQuality).toBe("1080p")
  })

  it("ratingSources default is ['imdb', 'tmdb'] and query rsrc overrides it", () => {
    expect(resolvePosterRenderConfig(baseInput()).ratingSources).toEqual(["imdb", "tmdb"])
    const rQuery = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rsrc: "imdb,tomatoes,metacritic" }),
    }))
    expect(rQuery.ratingSources).toEqual(["imdb", "tomatoes", "metacritic"])
  })
})

describe("poster transform", () => {
  it("query pscale/pox/poy beats the mapping, and values are clamped", () => {
    const m = mapping({ posterScale: 150, posterOffsetX: 10, posterOffsetY: -20 })
    expect(resolvePosterTransform(new URLSearchParams(), m)).toEqual({ posterScale: 150, posterOffsetX: 10, posterOffsetY: -20 })
    expect(resolvePosterTransform(new URLSearchParams({ pscale: "200", pox: "-5", poy: "7" }), m))
      .toEqual({ posterScale: 200, posterOffsetX: -5, posterOffsetY: 7 })
    expect(resolvePosterTransform(new URLSearchParams({ pscale: "50" }), null).posterScale).toBe(100)
    expect(resolvePosterTransform(new URLSearchParams({ pscale: "999" }), null).posterScale).toBe(300)
    expect(resolvePosterTransform(new URLSearchParams({ pscale: "abc" }), null).posterScale).toBe(100)
  })

  it("crop window is centred, follows the pan, and never leaves the image", () => {
    // 200% zoom of a 500×750 canvas → 1000×1500, centred window at (250, 375)
    expect(posterCropWindow(500, 750, { posterScale: 200, posterOffsetX: 0, posterOffsetY: 0 }))
      .toEqual({ scaledW: 1000, scaledH: 1500, left: 250, top: 375 })
    // Dragging the poster right/down moves the window left/up
    expect(posterCropWindow(500, 750, { posterScale: 200, posterOffsetX: 100, posterOffsetY: 50 }))
      .toMatchObject({ left: 150, top: 325 })
    // Clamped at the edges
    expect(posterCropWindow(500, 750, { posterScale: 200, posterOffsetX: 9999, posterOffsetY: -9999 }))
      .toMatchObject({ left: 0, top: 750 })
    // No zoom → no room to pan
    expect(posterCropWindow(500, 750, { posterScale: 100, posterOffsetX: 80, posterOffsetY: 80 }))
      .toEqual({ scaledW: 500, scaledH: 750, left: 0, top: 0 })
  })
})
