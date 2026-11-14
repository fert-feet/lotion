"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "!rounded-panel !hairline !border-shell-border-l2 !shadow-elevation-2 !text-ui",
          description: "!text-shell-label-secondary",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--shell-border-l2)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
