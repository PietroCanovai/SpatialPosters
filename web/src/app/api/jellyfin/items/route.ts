import { NextRequest } from "next/server"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"
import { isValidItemId, listItems, readJellyfinConfig } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!checkAdminToken(req)) return adminAuthResponse()
  const cfg = await readJellyfinConfig()
  if (!cfg) return Response.json({ error: "Jellyfin is not configured" }, { status: 409 })
  const sp = req.nextUrl.searchParams
  const parentId = sp.get("parentId")
  if (parentId && !isValidItemId(parentId)) return Response.json({ error: "Invalid parentId" }, { status: 400 })
  try {
    const result = await listItems(cfg, {
      parentId,
      search: sp.get("search")?.slice(0, 100) || null,
      start: Number(sp.get("start")) || 0,
      limit: Number(sp.get("limit")) || 60,
    })
    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
