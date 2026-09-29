import { describe, expect, it } from "vitest"
import enDict from "@/lib/translations/en.json"
import itDict from "@/lib/translations/it.json"
import jaDict from "@/lib/translations/ja.json"

const DICTS: Record<string, Record<string, string>> = { en: enDict, it: itDict, ja: jaDict }
const LANGS = Object.keys(DICTS)

function placeholders(s: string): string {
  const m = s.match(/\{[a-zA-Z]+\}/g) || []
  return [...new Set(m)].sort().join(",")
}

describe("translations parity", () => {
  it("all 3 dictionaries share the exact same key set", () => {
    const allKeys = new Set<string>()
    for (const l of LANGS) for (const k of Object.keys(DICTS[l])) allKeys.add(k)
    expect(allKeys.size).toBeGreaterThan(500)
    for (const l of LANGS) {
      const missing = [...allKeys].filter((k) => !(k in DICTS[l]))
      expect(missing, `${l} missing keys`).toEqual([])
    }
  })

  it("every key keeps the same {placeholders} as English", () => {
    const bad: string[] = []
    for (const k of Object.keys(enDict)) {
      const ref = placeholders((enDict as Record<string, string>)[k])
      for (const l of LANGS) {
        const mine = placeholders(DICTS[l][k] ?? "")
        if (mine !== ref) bad.push(`${l}:${k} en{${ref}} vs {${mine}}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("no empty values", () => {
    const bad: string[] = []
    for (const l of LANGS) {
      for (const [k, v] of Object.entries(DICTS[l])) {
        if (!v || !v.trim()) bad.push(`${l}:${k}`)
      }
    }
    expect(bad).toEqual([])
  })
})
