import { NextRequest } from "next/server"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"
import { isValidItemId, jellyfinFetch, readJellyfinConfig } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

/**
 * Proxy della locandina attuale in Jellyfin: il browser non conosce la API key
 * e la CSP (img-src) non ammette l'host Jellyfin.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminToken(req)) return adminAuthResponse()
  const { id } = await params
  if (!isValidItemId(id)) return new Response("Invalid id", { status: 400 })
  const cfg = await readJellyfinConfig()
  if (!cfg) return new Response("Jellyfin is not configured", { status: 409 })
  const q = new URLSearchParams({ maxWidth: "400", quality: "90" })
  const tag = req.nextUrl.searchParams.get("tag")
  if (tag && /^[a-f0-9]{1,64}$/i.test(tag)) q.set("tag", tag)
  try {
    const res = await jellyfinFetch(cfg, `/Items/${id}/Images/Primary?${q}`)
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        // Il tag cambia quando l'immagine cambia: con tag si può cachare a lungo.
        "Cache-Control": tag ? "private, max-age=86400" : "no-store",
      },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
