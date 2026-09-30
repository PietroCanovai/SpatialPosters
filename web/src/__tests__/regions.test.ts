import { describe, expect, it } from "vitest"
import {
  DEFAULT_REGION,
  REGIONS,
  SUPPORTED_UI_LANGS,
  defaultRegionForLang,
  flixSlugToRegionCode,
  getRegionDef,
  isSupportedUiLang,
  normalizeRegion,
  parseRegion,
  regionToFlixSlug,
} from "@/lib/regions"
import { PICKER_LANGS } from "@/lib/utils"

// Questa fork supporta solo Italia, USA, Regno Unito e Giappone.
describe("regions", () => {
  it("exposes 4 regions with unique codes and slugs", () => {
    expect(REGIONS.map((r) => r.code)).toEqual(["IT", "US", "GB", "JP"])
    expect(new Set(REGIONS.map((r) => r.flixSlug)).size).toBe(4)
    for (const r of REGIONS) {
      expect(r.code).toMatch(/^[A-Z]{2}$/)
      expect(r.lang).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it("parseRegion accepts JW codes case-insensitively", () => {
    expect(parseRegion("IT")).toBe("IT")
    expect(parseRegion("us")).toBe("US")
    expect(parseRegion("  gb ")).toBe("GB")
    expect(parseRegion("jp")).toBe("JP")
  })

  it("parseRegion accepts FlixPatrol slugs", () => {
    expect(parseRegion("italy")).toBe("IT")
    expect(parseRegion("united-states")).toBe("US")
    expect(parseRegion("United-Kingdom")).toBe("GB")
    expect(parseRegion("japan")).toBe("JP")
  })

  it("parseRegion fails closed on removed or unknown regions", () => {
    for (const r of ["atlantis", "DE", "IL", "AU", "RU", "germany", "israel", "australia", "", null, undefined]) {
      expect(parseRegion(r)).toBeNull()
    }
    expect(normalizeRegion("atlantis")).toBe(DEFAULT_REGION)
    expect(normalizeRegion("IL")).toBe("US")
    expect(normalizeRegion(undefined)).toBe("US")
  })

  it("maps region to Flix slug and TMDB/JW language", () => {
    expect(regionToFlixSlug("US")).toBe("united-states")
    expect(regionToFlixSlug("atlantis")).toBe("united-states")
    expect(getRegionDef("JP").lang).toBe("ja-JP")
    expect(getRegionDef("GB").lang).toBe("en-GB")
    expect(getRegionDef("IT")).toMatchObject({ flag: "🇮🇹", label: "Italy", nativeLabel: "Italia" })
    expect(getRegionDef("US")).toMatchObject({ flag: "🇺🇸", label: "United States" })
  })

  it("flixSlugToRegionCode round-trips supported slugs", () => {
    expect(flixSlugToRegionCode("japan")).toBe("JP")
    expect(flixSlugToRegionCode("united-kingdom")).toBe("GB")
    expect(flixSlugToRegionCode("israel")).toBeNull()
    expect(flixSlugToRegionCode("albania")).toBeNull()
  })

  it("maps each region to a 2-letter UI language", () => {
    expect(getRegionDef("IT").lang2).toBe("it")
    expect(getRegionDef("US").lang2).toBe("en")
    expect(getRegionDef("GB").lang2).toBe("en")
    expect(getRegionDef("JP").lang2).toBe("ja")
    for (const r of REGIONS) {
      expect(r.lang.toLowerCase().startsWith(r.lang2)).toBe(true)
    }
  })

  it("supports only Italian, English and Japanese UI", () => {
    expect(SUPPORTED_UI_LANGS).toEqual(["it", "en", "ja"])
    for (const l of ["fr", "de", "es", "he", "ko", "pt", "ru", "", null, undefined]) {
      expect(isSupportedUiLang(l)).toBe(false)
    }
  })

  it("PICKER_LANGS lists exactly the 4 nationalities", () => {
    expect(PICKER_LANGS.map((l) => l.key)).toEqual(REGIONS.map((r) => r.code))
    for (const l of PICKER_LANGS) {
      expect(l.flag).toBeTruthy()
      expect(l.name).toContain("·")
      expect(isSupportedUiLang(l.code)).toBe(true)
    }
  })

  it("defaultRegionForLang resolves region from language and preserves regional variants", () => {
    expect(defaultRegionForLang("it")).toBe("IT")
    expect(defaultRegionForLang("ja")).toBe("JP")
    expect(defaultRegionForLang("en")).toBe("US")
    expect(defaultRegionForLang("en", "GB")).toBe("GB")
    expect(defaultRegionForLang("en", "IT")).toBe("US")
    expect(defaultRegionForLang("fr")).toBeNull()
    expect(defaultRegionForLang(null)).toBeNull()
  })
})
