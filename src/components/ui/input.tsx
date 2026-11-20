import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "rr:h-9 rr:w-full rr:min-w-0 rr:rounded-md rr:border rr:border-input rr:bg-transparent rr:px-3 rr:py-1 rr:text-base rr:shadow-xs rr:transition-[color,box-shadow] rr:outline-none rr:selection:bg-primary rr:selection:text-primary-foreground rr:file:inline-flex rr:file:h-7 rr:file:border-0 rr:file:bg-transparent rr:file:text-sm rr:file:font-medium rr:file:text-foreground rr:placeholder:text-muted-foreground rr:disabled:pointer-events-none rr:disabled:cursor-not-allowed rr:disabled:opacity-50 rr:md:text-sm rr:dark:bg-input/30",
        "rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50",
        "rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
