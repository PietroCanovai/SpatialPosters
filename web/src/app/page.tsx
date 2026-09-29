"use client"

import { PictoriumRoot } from "@/lib/context"
import { AppShell } from "@/components/AppShell"
import { HomeView } from "@/components/HomeView"

export default function Home() {
  return (
    <PictoriumRoot>
      <AppShell>
        <HomeView />
      </AppShell>
    </PictoriumRoot>
  )
}
