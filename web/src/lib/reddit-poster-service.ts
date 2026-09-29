import { cacheGet, cacheSet } from "./cache"

export interface RedditPoster {
  id: string
  title: string
  url: string // The high-res image URL
  author: string
  upvotes: number
  flair: string | null
  permalink: string
}

const REDDIT_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
const REDDIT_EMPTY_TTL = 60 * 1000 // 1 minute for empty results (waiting for Reddit index)

export async function fetchRedditPosters(tmdbId: string, forceRefetch = false): Promise<RedditPoster[]> {
  const cacheKey = `reddit_posters_${tmdbId}`
  
  // 1. Check Cache
  if (!forceRefetch) {
    const cached = await cacheGet<RedditPoster[]>(cacheKey)
    if (cached) return cached
  }
  
  try {
    // 2. Query Reddit RSS API (bypasses datacenter JSON blocks)
    // Search for the TMDB ID in the SpatialPosters subreddit
    const query = encodeURIComponent(`${tmdbId}`)
    const res = await fetch(
      `https://www.reddit.com/r/SpatialPosters/search.rss?q=${query}&restrict_sr=on&sort=new`,
      {
        headers: {
          "User-Agent": "web:SpatialPosters:v1.0 (by /u/TheAceOfficials)",
          "Accept": "application/atom+xml,application/xml,text/xml"
        },
        cache: "no-store" 
      }
    )

    if (!res.ok) {
      console.error(`[Reddit API] Failed to fetch posters for TMDB ${tmdbId}: ${res.statusText}`)
      return []
    }

    const xmlText = await res.text()
    
    // 3. Parse XML using Regex to extract entries
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
    const entries = [...xmlText.matchAll(entryRegex)].map(m => m[1])

    const posters: RedditPoster[] = []

    for (const entry of entries) {
      // Must match TMDB ID specifically
      if (!entry.includes(`[TMDB: ${tmdbId}]`)) continue

      // Extract author
      const authorMatch = entry.match(/<author><name>\/u\/([^<]+)<\/name>/)
      const author = authorMatch ? authorMatch[1] : "Unknown"

      // Extract title
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/)
      const title = titleMatch ? titleMatch[1] : `Post for TMDB ${tmdbId}`
      
      let flair = "Reddit Poster"
      if (title.toLowerCase().includes("text")) flair = "Text Poster"
      else if (title.toLowerCase().includes("clean")) flair = "Clean Poster"

      // Extract image URL (Reddit direct image link)
      let url = ""
      const linkMatch = entry.match(/href=(?:&quot;|")([^&"]+i\.redd\.it[^&"]+)(?:&quot;|")/)
      if (linkMatch) {
        url = linkMatch[1]
      } else {
        const thumbMatch = entry.match(/<media:thumbnail url="([^"]+)"/)
        if (thumbMatch) {
           url = thumbMatch[1].replace(/&amp;/g, "&")
        }
      }
      
      const idMatch = entry.match(/<id>([^<]+)<\/id>/)
      const id = idMatch ? idMatch[1] : Math.random().toString()

      if (url) {
        posters.push({
          id,
          title,
          url,
          author,
          upvotes: 0, // RSS doesn't provide score easily
          flair,
          permalink: `https://www.reddit.com/r/SpatialPosters/search?q=${tmdbId}`
        })
      }
    }

    // 4. Set Cache (Short TTL if empty)
    const ttl = posters.length > 0 ? REDDIT_CACHE_TTL : REDDIT_EMPTY_TTL
    await cacheSet(cacheKey, posters, ["reddit-posters"], ttl)
    
    return posters
  } catch (error) {
    console.error(`[Reddit API] Exception fetching posters for TMDB ${tmdbId}:`, error)
    return [] // Fail gracefully, don't break the app!
  }
}
