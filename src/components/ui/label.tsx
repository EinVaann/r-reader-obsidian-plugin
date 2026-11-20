import * as React from "react"
import { cn } from "@/lib/utils"
import { Label as LabelPrimitive } from "radix-ui"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "rr:flex rr:items-center rr:gap-2 rr:text-sm rr:leading-none rr:font-medium rr:select-none rr:group-data-[disabled=true]:pointer-events-none rr:group-data-[disabled=true]:opacity-50 rr:peer-disabled:cursor-not-allowed rr:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
