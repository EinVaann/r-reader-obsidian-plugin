import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "rr:flex rr:field-sizing-content rr:min-h-16 rr:w-full rr:rounded-md rr:border rr:border-input rr:bg-transparent rr:px-3 rr:py-2 rr:text-base rr:shadow-xs rr:transition-[color,box-shadow] rr:outline-none rr:placeholder:text-muted-foreground rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:disabled:cursor-not-allowed rr:disabled:opacity-50 rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:md:text-sm rr:dark:bg-input/30 rr:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
