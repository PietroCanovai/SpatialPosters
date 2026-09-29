import path from "node:path"
import { envWithFallback } from "@/lib/env-compat"

export const DATA_DIR = envWithFallback("DATA_DIR") || path.join(process.cwd(), "data")
