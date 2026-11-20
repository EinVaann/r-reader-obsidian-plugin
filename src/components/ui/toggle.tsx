import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

// m-0/shadow-none undo Obsidian's <button> styles.
const toggleVariants = cva(
  "rr:m-0 rr:shadow-none rr:inline-flex rr:items-center rr:justify-center rr:gap-2 rr:rounded-md rr:text-sm rr:font-medium rr:whitespace-nowrap rr:transition-[color,box-shadow] rr:outline-none rr:hover:bg-muted rr:hover:text-muted-foreground rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:disabled:pointer-events-none rr:disabled:opacity-50 rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:data-[state=on]:bg-accent rr:data-[state=on]:text-accent-foreground rr:dark:aria-invalid:ring-destructive/40 rr:[&_svg]:pointer-events-none rr:[&_svg]:shrink-0 rr:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "rr:bg-transparent",
        outline:
          "rr:border rr:border-input rr:bg-transparent rr:shadow-xs rr:hover:bg-accent rr:hover:text-accent-foreground",
      },
      size: {
        default: "rr:h-9 rr:min-w-9 rr:px-2",
        sm: "rr:h-8 rr:min-w-8 rr:px-1.5",
        lg: "rr:h-10 rr:min-w-10 rr:px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
