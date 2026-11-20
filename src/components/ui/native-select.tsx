import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"

function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div
      className="rr:group/native-select rr:relative rr:w-fit rr:has-[select:disabled]:opacity-50"
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          // m-0/bg-none: Obsidian draws its own caret on <select>.
          "rr:m-0 rr:bg-none rr:h-9 rr:w-full rr:min-w-0 rr:appearance-none rr:rounded-md rr:border rr:border-input rr:bg-transparent rr:px-3 rr:py-2 rr:pr-9 rr:text-sm rr:shadow-xs rr:transition-[color,box-shadow] rr:outline-none rr:selection:bg-primary rr:selection:text-primary-foreground rr:placeholder:text-muted-foreground rr:disabled:pointer-events-none rr:disabled:cursor-not-allowed rr:data-[size=sm]:h-8 rr:data-[size=sm]:py-1 rr:dark:bg-input/30 rr:dark:hover:bg-input/50",
          "rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50",
          "rr:aria-invalid:border-destructive rr:aria-invalid:ring-destructive/20 rr:dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
      <ChevronDownIcon
        className="rr:pointer-events-none rr:absolute rr:top-1/2 rr:right-3.5 rr:size-4 rr:-translate-y-1/2 rr:text-muted-foreground rr:opacity-50 rr:select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("rr:bg-[Canvas] rr:text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("rr:bg-[Canvas] rr:text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
