"use client"

import React from "react"
import { PictoriumRoot } from "@/lib/context"
import { ToastProvider } from "@/components/Toast"
import { AmbientBackground } from "@/components/AmbientBackground"
import { DesktopSidebar } from "@/components/DesktopSidebar"
import { MobileDock } from "@/components/MobileDock"
import { JellyfinView } from "@/components/JellyfinView"

export default function JellyfinPage() {
  return (
    <PictoriumRoot>
      <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
        <AmbientBackground />
        <DesktopSidebar />
        <ToastProvider>
          <div className="relative z-10 max-w-[1680px] mx-auto px-4 sm:px-6 pt-6 sm:pt-10 md:pt-14 lg:pt-16 pb-24 md:pb-8 md:pl-20">
            <JellyfinView />
          </div>
        </ToastProvider>
        <MobileDock />
      </div>
    </PictoriumRoot>
  )
}
