import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // p-0/justify-start/m-0: Obsidian pads and centres <button> content, which would push the thumb off.
        "rr:p-0 rr:m-0 rr:justify-start rr:peer rr:group/switch rr:inline-flex rr:shrink-0 rr:items-center rr:rounded-full rr:border rr:border-transparent rr:shadow-xs rr:transition-all rr:outline-none rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:disabled:cursor-not-allowed rr:disabled:opacity-50 rr:data-[size=default]:h-[1.15rem] rr:data-[size=default]:w-8 rr:data-[size=sm]:h-3.5 rr:data-[size=sm]:w-6 rr:data-[state=checked]:bg-primary rr:data-[state=unchecked]:bg-input rr:dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "rr:pointer-events-none rr:block rr:rounded-full rr:bg-background rr:ring-0 rr:transition-transform rr:group-data-[size=default]/switch:size-4 rr:group-data-[size=sm]/switch:size-3 rr:data-[state=checked]:translate-x-[calc(100%-2px)] rr:data-[state=unchecked]:translate-x-0 rr:dark:data-[state=checked]:bg-primary-foreground rr:dark:data-[state=unchecked]:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
