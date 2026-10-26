"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { usePrefs } from "@/components/providers/PrefsProvider"

const Toaster = ({ ...props }: ToasterProps) => {
  const { prefs } = usePrefs()

  return (
    <Sonner
      theme={prefs.mode === 'auto' ? 'system' : prefs.mode}
      className="toaster group"
      mobileOffset={{ bottom: 72 }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--rm)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
