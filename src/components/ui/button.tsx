import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Obsidian styles every <button> (background, shadow, padding, border: 0); m-0/bg-transparent/shadow-none undo that.
const buttonVariants = cva(
  "rr:m-0 rr:bg-transparent rr:shadow-none rr:inline-flex rr:shrink-0 rr:items-center rr:justify-center rr:gap-2 rr:rounded-md rr:text-sm rr:font-medium rr:whitespace-nowrap rr:transition-all rr:outline-none rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:disabled:pointer-events-none rr:disabled:opacity-50 rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:dark:aria-invalid:ring-destructive/40 rr:[&_svg]:pointer-events-none rr:[&_svg]:shrink-0 rr:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "rr:bg-primary rr:text-primary-foreground rr:hover:bg-primary/90",
        destructive:
          "rr:bg-destructive rr:text-white rr:hover:bg-destructive/90 rr:focus-visible:ring-destructive/20 rr:dark:bg-destructive/60 rr:dark:focus-visible:ring-destructive/40",
        outline:
          "rr:border rr:border-border rr:bg-background rr:shadow-xs rr:hover:bg-accent rr:hover:text-accent-foreground rr:dark:border-input rr:dark:bg-input/30 rr:dark:hover:bg-input/50",
        secondary:
          "rr:bg-secondary rr:text-secondary-foreground rr:hover:bg-secondary/80",
        ghost:
          "rr:hover:bg-accent rr:hover:text-accent-foreground rr:dark:hover:bg-accent/50",
        link: "rr:text-primary rr:underline-offset-4 rr:hover:underline",
      },
      size: {
        default: "rr:h-9 rr:px-4 rr:py-2 rr:has-[>svg]:px-3",
        xs: "rr:h-6 rr:gap-1 rr:rounded-md rr:px-2 rr:text-xs rr:has-[>svg]:px-1.5 rr:[&_svg:not([class*=size-])]:size-3",
        sm: "rr:h-8 rr:gap-1.5 rr:rounded-md rr:px-3 rr:has-[>svg]:px-2.5",
        lg: "rr:h-10 rr:rounded-md rr:px-6 rr:has-[>svg]:px-4",
        icon: "rr:size-9 rr:p-0",
        "icon-xs": "rr:size-6 rr:p-0 rr:rounded-md rr:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "rr:size-8 rr:p-0",
        "icon-lg": "rr:size-10 rr:p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
