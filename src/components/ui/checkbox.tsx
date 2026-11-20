"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // p-0/m-0/bg-transparent undo Obsidian's <button> styles.
        "rr:p-0 rr:m-0 rr:bg-transparent rr:peer rr:size-4 rr:shrink-0 rr:rounded-[4px] rr:border rr:border-input rr:shadow-xs rr:transition-shadow rr:outline-none rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:disabled:cursor-not-allowed rr:disabled:opacity-50 rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:data-[state=checked]:border-primary rr:data-[state=checked]:bg-primary rr:data-[state=checked]:text-primary-foreground rr:dark:bg-input/30 rr:dark:aria-invalid:ring-destructive/40 rr:dark:data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="rr:grid rr:place-content-center rr:text-current rr:transition-none"
      >
        <CheckIcon className="rr:size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
