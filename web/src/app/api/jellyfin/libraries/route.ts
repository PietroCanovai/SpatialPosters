import { NextRequest } from "next/server"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"
import { listLibraries, readJellyfinConfig } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!checkAdminToken(req)) return adminAuthResponse()
  const cfg = await readJellyfinConfig()
  if (!cfg) return Response.json({ error: "Jellyfin is not configured" }, { status: 409 })
  try {
    return Response.json({ libraries: await listLibraries(cfg) })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
