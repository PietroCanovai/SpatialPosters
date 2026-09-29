import type { Mapping, PosterVariant, LogoVariant } from "./types"

/**
 * Configurazione per singolo poster di un titolo. Ogni immagine poster ha la
 * propria trasformazione, colore accento, blur/sfumatura e logo scelto; ogni
 * coppia poster+logo ha la propria scala/posizione del logo. Così si possono
 * combinare poster e loghi diversi senza che le impostazioni di uno
 * sovrascrivano l'altro. I campi di primo livello del mapping restano quelli
 * del poster salvato per ultimo (compatibilità e fallback).
 */

/** Numero massimo di varianti per titolo (i titoli hanno al più qualche decina di poster). */
export const MAX_POSTER_VARIANTS = 200
export const MAX_LOGO_VARIANTS = 60

/**
 * Mapping "effettivo" per un poster/logo: i campi della variante di quel poster
 * (e del logo su quel poster) sovrascrivono quelli di primo livello. Usato dal
 * renderer, così anche un poster in rotazione usa la propria configurazione.
 */
export function applyPosterVariant(mapping: Mapping | null, posterPath: string | null | undefined, logoPath: string | null | undefined): Mapping | null {
  if (!mapping || !posterPath) return mapping
  const v = mapping.variants?.[posterPath]
  if (!v) return mapping
  const l: LogoVariant | undefined = logoPath ? v.logos?.[logoPath] : undefined
  const pick = <T,>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value)
  return {
    ...mapping,
    posterScale: pick(v.posterScale, mapping.posterScale),
    posterOffsetX: pick(v.posterOffsetX, mapping.posterOffsetX),
    posterOffsetY: pick(v.posterOffsetY, mapping.posterOffsetY),
    accentColor: pick(v.accentColor, mapping.accentColor),
    gradientHeight: pick(v.gradientHeight, mapping.gradientHeight),
    blurEnabled: pick(v.blurEnabled, mapping.blurEnabled),
    blurIntensity: pick(v.blurIntensity, mapping.blurIntensity),
    blurFade: pick(v.blurFade, mapping.blurFade),
    blurDarkness: pick(v.blurDarkness, mapping.blurDarkness),
    // Il logo di questo poster, se la variante lo specifica (null = senza logo).
    logoPath: v.logoPath === undefined ? mapping.logoPath : v.logoPath,
    logoScale: l ? pick(l.logoScale, mapping.logoScale) : mapping.logoScale,
    logoOffsetX: l ? pick(l.logoOffsetX, mapping.logoOffsetX) : mapping.logoOffsetX,
    logoOffsetY: l ? pick(l.logoOffsetY, mapping.logoOffsetY) : mapping.logoOffsetY,
  }
}

/** Stato dell'editor salvato per un poster (ciò che cambia da un poster all'altro). */
export interface PosterEditorSnapshot {
  posterScale: number
  posterOffsetX: number
  posterOffsetY: number
  accentColor: string | null
  gradientHeight: number
  blurEnabled: boolean
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Logo scelto per questo poster; null = nessun logo. */
  logoPath: string | null
  logoScale: number
  logoOffsetX: number
  logoOffsetY: number
}

/** Aggiorna la mappa varianti con lo stato corrente dell'editor per `posterPath`. */
export function storeVariant(
  variants: Record<string, PosterVariant>,
  posterPath: string,
  s: PosterEditorSnapshot,
): Record<string, PosterVariant> {
  const prev = variants[posterPath]
  const logos = { ...(prev?.logos ?? {}) }
  if (s.logoPath) {
    logos[s.logoPath] = {
      logoScale: Math.round(s.logoScale),
      logoOffsetX: Math.round(s.logoOffsetX),
      logoOffsetY: Math.round(s.logoOffsetY),
    }
  }
  const next: PosterVariant = {
    posterScale: Math.round(s.posterScale),
    posterOffsetX: Math.round(s.posterOffsetX),
    posterOffsetY: Math.round(s.posterOffsetY),
    accentColor: s.accentColor,
    gradientHeight: s.gradientHeight,
    blurEnabled: s.blurEnabled,
    blurIntensity: s.blurIntensity,
    blurFade: s.blurFade,
    blurDarkness: s.blurDarkness,
    logoPath: s.logoPath,
    logos: trimRecord(logos, MAX_LOGO_VARIANTS, s.logoPath),
  }
  return trimRecord({ ...variants, [posterPath]: next }, MAX_POSTER_VARIANTS, posterPath)
}

/** Tiene al più `max` voci, conservando sempre `keep` (le più vecchie escono per prime). */
function trimRecord<T>(rec: Record<string, T>, max: number, keep: string | null): Record<string, T> {
  const keys = Object.keys(rec)
  if (keys.length <= max) return rec
  const hasKeep = !!keep && rec[keep] !== undefined
  const others = keys.filter((k) => k !== keep)
  const room = hasKeep ? max - 1 : max
  const out: Record<string, T> = {}
  for (const k of others.slice(Math.max(0, others.length - room))) out[k] = rec[k]
  if (hasKeep) out[keep!] = rec[keep!]
  return out
}
