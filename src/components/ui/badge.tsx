import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "rr:inline-flex rr:w-fit rr:shrink-0 rr:items-center rr:justify-center rr:gap-1 rr:overflow-hidden rr:rounded-full rr:border rr:border-transparent rr:px-2 rr:py-0.5 rr:text-xs rr:font-medium rr:whitespace-nowrap rr:transition-[color,box-shadow] rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:dark:aria-invalid:ring-destructive/40 rr:[&>svg]:pointer-events-none rr:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "rr:bg-primary rr:text-primary-foreground rr:[a&]:hover:bg-primary/90",
        secondary:
          "rr:bg-secondary rr:text-secondary-foreground rr:[a&]:hover:bg-secondary/90",
        destructive:
          "rr:bg-destructive rr:text-white rr:focus-visible:ring-destructive/20 rr:dark:bg-destructive/60 rr:dark:focus-visible:ring-destructive/40 rr:[a&]:hover:bg-destructive/90",
        outline:
          "rr:border-border rr:text-foreground rr:[a&]:hover:bg-accent rr:[a&]:hover:text-accent-foreground",
        ghost: "rr:[a&]:hover:bg-accent rr:[a&]:hover:text-accent-foreground",
        link: "rr:text-primary rr:underline-offset-4 rr:[a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
