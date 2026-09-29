// ---------------------------------------------------------------------------
// Parsing della configurazione di resa (badge/blur/gradiente/logo/poster)
// della route poster da query string + mapping + server defaults.
// Estratto dalla route `/api/poster/[type]/[id]` per renderlo testabile in
// isolamento. Precedenza: query > mapping salvato > server defaults > default.
// ---------------------------------------------------------------------------

import type { Mapping } from "./types"
import type { ServerDefaults } from "./server-defaults"
import { resolveLabelFor } from "./i18n"
import { SUPPORTED_RATING_SOURCES, DEFAULT_RATING_SOURCES } from "./ratings"
import {
  isBadgeStyle,
  isRankingBadgeStyle,
  DEFAULT_BADGE_STYLE,
  DEFAULT_RANKING_BADGE_STYLE,
  type BadgeStyle,
  type RankingBadgeStyle,
} from "./badge-styles"

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** Zoom del poster sotto il logo, in % (100 = riempie il canvas come prima). */
export const POSTER_SCALE_MIN = 100
export const POSTER_SCALE_MAX = 300

export interface PosterRenderConfigInput {
  searchParams: URLSearchParams
  mapping: Mapping | null
  sd: ServerDefaults
  /** true se la richiesta fornisce poster/mapping espliciti (query o mapping salvato) */
  hasQuery: boolean
  showBadges: boolean
  rankingBadges: boolean
  /** segnali di classifica per l'auto-detect default→netflix */
  animeRank: number | null
  rankingResult: number | null
  finalRank: number | null
  /** lingua per la risoluzione delle label prefissate (__badge.*) — fix L32 */
  lang?: string
}

export interface PosterRenderConfig {
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  blurEnabled: boolean
  blurHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  badgesEnabled: boolean
  rankingEnabled: boolean
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  manualQuality: string | null
  badgeFormat: string | null
  ratingSources: string[]
  logoScale: number | null
  logoOffsetX: number | null
  logoOffsetY: number | null
  /** Trasformazione del poster sotto il logo (zoom % e pan in px del canvas 500×750). */
  posterScale: number
  posterOffsetX: number
  posterOffsetY: number
  /** true: il logo non viene composto (la preview lo disegna lato client). */
  omitLogo: boolean
  queryExtra: string | null
  qNetLogo: string | null
  networkLogo: boolean
  ribbonSide: "left" | "right"
}

function finiteOr(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export interface PosterTransform {
  posterScale: number
  posterOffsetX: number
  posterOffsetY: number
}

/** Zoom/pan del poster: query `pscale/pox/poy` > mapping salvato > nessuna trasformazione. */
export function resolvePosterTransform(q: URLSearchParams, mapping: Mapping | null): PosterTransform {
  return {
    posterScale: clamp(finiteOr(q.get("pscale"), mapping?.posterScale ?? POSTER_SCALE_MIN), POSTER_SCALE_MIN, POSTER_SCALE_MAX),
    posterOffsetX: Math.round(clamp(finiteOr(q.get("pox"), mapping?.posterOffsetX ?? 0), -2000, 2000)),
    posterOffsetY: Math.round(clamp(finiteOr(q.get("poy"), mapping?.posterOffsetY ?? 0), -3000, 3000)),
  }
}

/**
 * Finestra di crop (in px dell'immagine già scalata) per zoom + pan del poster.
 * L'immagine viene prima portata in "cover" sul canvas × zoom, poi si ritaglia
 * una finestra canvasW×canvasH spostata di (-offsetX, -offsetY) dal centro e
 * vincolata ai bordi: non si può trascinare oltre l'immagine. Condivisa con la
 * preview live lato client, così trascinamento e render finale coincidono.
 */
export function posterCropWindow(canvasW: number, canvasH: number, t: PosterTransform): { scaledW: number; scaledH: number; left: number; top: number } {
  const z = clamp(t.posterScale, POSTER_SCALE_MIN, POSTER_SCALE_MAX) / 100
  const scaledW = Math.round(canvasW * z)
  const scaledH = Math.round(canvasH * z)
  const left = Math.round(clamp((scaledW - canvasW) / 2 - t.posterOffsetX, 0, scaledW - canvasW))
  const top = Math.round(clamp((scaledH - canvasH) / 2 - t.posterOffsetY, 0, scaledH - canvasH))
  return { scaledW, scaledH, left, top }
}

export function resolvePosterRenderConfig(input: PosterRenderConfigInput): PosterRenderConfig {
  const { searchParams: q, mapping, sd, hasQuery, showBadges, rankingBadges } = input

  // Ranking style — precedenza: query `rs` > mapping salvato > server defaults > default.
  // Il sentinel "default" del mapping è trattato come "nessun override", identico
  // a come "shadow" lo è per badgeStyle.
  const rawRs =
    q.get("rs") ||
    (mapping?.rankingBadgeStyle && mapping.rankingBadgeStyle !== "default" ? mapping.rankingBadgeStyle : undefined) ||
    sd.rankingBadgeStyle
  let rankingBadgeStyle: RankingBadgeStyle = isRankingBadgeStyle(rawRs) ? rawRs : DEFAULT_RANKING_BADGE_STYLE

  const qRankParam = q.get("rank")
  const hasRank = !!(input.animeRank || input.rankingResult || mapping?.badgeRank || mapping?.trendRank || qRankParam || input.finalRank)
  // "default" = auto-detect: badge stile Netflix se c'è un rank, altrimenti
  // standard. Un valore esplicito (bar/pill/colored/netflix) viene rispettato.
  if (hasRank && rankingBadgeStyle === "default") {
    rankingBadgeStyle = "netflix"
  } else if (!hasRank && rankingBadgeStyle === "netflix") {
    rankingBadgeStyle = "default"
  }

  // Clamp espliciti: impediscono a valori estremi di arrivare a sharp.blur con
  // sigma enormi o gradienti fuori scala (potenziale DoS CPU).
  const blurEnabled = q.get("be") !== null
    ? q.get("be") !== "0"
    : (mapping?.blurEnabled ?? true)
  const rawGradHeight = q.get("gradHeight") ? Number(q.get("gradHeight")) : NaN
  const blurHeight = Number.isFinite(rawGradHeight)
    ? clamp(rawGradHeight, 5, 100)
    : (mapping?.gradientHeight != null && Number.isFinite(mapping.gradientHeight) ? clamp(mapping.gradientHeight, 5, 100) : 30)
  const rawBlur = q.get("blur") ? Number(q.get("blur")) : NaN
  const blurIntensity = Number.isFinite(rawBlur)
    ? clamp(rawBlur, 1, 100)
    : (mapping?.blurIntensity != null && Number.isFinite(mapping.blurIntensity) ? clamp(mapping.blurIntensity, 1, 100) : 5)
  const rawBf = q.get("bf") ? Number(q.get("bf")) : NaN
  const blurFade = Number.isFinite(rawBf)
    ? clamp(rawBf, 0, 100)
    : (mapping?.blurFade != null && Number.isFinite(mapping.blurFade) ? clamp(mapping.blurFade, 0, 100) : 60)
  const rawBd = q.get("bd") ? Number(q.get("bd")) : NaN
  const blurDarkness = Number.isFinite(rawBd)
    ? clamp(rawBd, 0, 100)
    : (mapping?.blurDarkness != null && Number.isFinite(mapping.blurDarkness) ? clamp(mapping.blurDarkness, 0, 100) : 40)

  const qBadges = q.get("badges")
  const qRanking = q.get("ranking")
  const badgesEnabled = hasQuery ? (qBadges !== null ? qBadges !== "0" : showBadges) : true
  const rankingEnabled = hasQuery ? (qRanking !== null ? qRanking !== "0" : rankingBadges) : true

  // Componenti badge genere/rating — precedenza: query `bg/by/br` > mapping
  // salvato > server defaults > true (tutti ON di default).
  const qBg = q.get("bg")
  const qBy = q.get("by")
  const qBr = q.get("br")
  const badgeGenre = qBg !== null ? qBg !== "0" : (mapping?.badgeGenre ?? sd.badgeGenre ?? true)
  const badgeYear = qBy !== null ? qBy !== "0" : (mapping?.badgeYear ?? sd.badgeYear ?? true)
  const badgeRating = qBr !== null ? qBr !== "0" : (mapping?.badgeRating ?? sd.badgeRating ?? true)
  const qMq = q.get("mq")
  const manualQuality = qMq !== null ? qMq : (mapping?.manualQuality ?? sd.manualQuality ?? null)
  const qMf = q.get("mf")
  const badgeFormat = qMf !== null ? qMf : (mapping?.badgeFormat ?? sd.badgeFormat ?? null)

  const qRsrc = q.get("rsrc")
  const validSources = SUPPORTED_RATING_SOURCES as readonly string[]
  const ratingSources: string[] = qRsrc !== null
    ? qRsrc.split(",").map((s) => s.trim().toLowerCase()).filter((s) => validSources.includes(s))
    : [...DEFAULT_RATING_SOURCES]

  // Badge style — confinamento della query string al union type: valori non
  // validi cadono sul default.
  const rawBs = q.get("bs")
    || (mapping?.badgeStyle && mapping.badgeStyle !== "shadow" ? mapping.badgeStyle : undefined)
    || sd.badgeStyle
  const badgeStyle: BadgeStyle = isBadgeStyle(rawBs) ? rawBs : DEFAULT_BADGE_STYLE

  const qScale = q.get("scale")
  const qOx = q.get("ox")
  const qOy = q.get("oy")
  const logoScale = qScale ? Number(qScale) || null : mapping?.logoScale ?? null
  const logoOffsetX = qOx ? Number(qOx) || null : mapping?.logoOffsetX ?? null
  const logoOffsetY = qOy ? Number(qOy) || null : mapping?.logoOffsetY ?? null

  const { posterScale, posterOffsetX, posterOffsetY } = resolvePosterTransform(q, mapping)
  const omitLogo = q.get("nologo") === "1"

  // Fix L32: le label prefissate (__badge.*) vengono risolte con la lingua
  // della richiesta.
  const rawExtra = q.get("extra") || null
  const queryExtra = rawExtra ? resolveLabelFor(rawExtra, input.lang || "en") : null
  const rawNetLogo = q.get("netLogo")
  const networkLogo: boolean = rawNetLogo !== null
    ? rawNetLogo !== "0"
    : (mapping?.networkLogo ?? sd.networkLogo ?? true)
  const qNetLogo = networkLogo ? rawNetLogo : "0"
  // Lato del nastro classifica: query `side`, altrimenti mapping salvato.
  const qSide = q.get("side")
  const ribbonSide: "left" | "right" = qSide === "right"
    ? "right"
    : qSide === "left"
      ? "left"
      : (mapping?.ribbonSide === "right" ? "right" : "left")

  return {
    badgeStyle,
    rankingBadgeStyle,
    blurEnabled,
    blurHeight,
    blurIntensity,
    blurFade,
    blurDarkness,
    badgesEnabled,
    rankingEnabled,
    badgeGenre,
    badgeYear,
    badgeRating,
    manualQuality,
    badgeFormat,
    ratingSources,
    logoScale,
    logoOffsetX,
    logoOffsetY,
    posterScale,
    posterOffsetX,
    posterOffsetY,
    omitLogo,
    queryExtra,
    qNetLogo,
    networkLogo,
    ribbonSide,
  }
}
