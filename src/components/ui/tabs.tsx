"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "rr:group/tabs rr:flex rr:gap-2 rr:data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "rr:group/tabs-list rr:inline-flex rr:w-fit rr:items-center rr:justify-center rr:rounded-lg rr:p-[3px] rr:text-muted-foreground rr:group-data-[orientation=horizontal]/tabs:h-9 rr:group-data-[orientation=vertical]/tabs:h-fit rr:group-data-[orientation=vertical]/tabs:flex-col rr:data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "rr:bg-muted",
        line: "rr:gap-1 rr:bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // m-0/bg-transparent/shadow-none undo Obsidian's <button> styles.
        "rr:m-0 rr:bg-transparent rr:shadow-none rr:relative rr:inline-flex rr:h-[calc(100%-1px)] rr:flex-1 rr:items-center rr:justify-center rr:gap-1.5 rr:rounded-md rr:border rr:border-transparent rr:px-2 rr:py-1 rr:text-sm rr:font-medium rr:whitespace-nowrap rr:text-foreground/60 rr:transition-all rr:group-data-[orientation=vertical]/tabs:w-full rr:group-data-[orientation=vertical]/tabs:justify-start rr:hover:text-foreground rr:focus-visible:border-ring rr:focus-visible:ring-[3px] rr:focus-visible:ring-ring/50 rr:focus-visible:outline-1 rr:focus-visible:outline-ring rr:disabled:pointer-events-none rr:disabled:opacity-50 rr:group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm rr:group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none rr:dark:text-muted-foreground rr:dark:hover:text-foreground rr:[&_svg]:pointer-events-none rr:[&_svg]:shrink-0 rr:[&_svg:not([class*=size-])]:size-4",
        "rr:group-data-[variant=line]/tabs-list:bg-transparent rr:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent rr:dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent rr:dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "rr:data-[state=active]:bg-background rr:data-[state=active]:text-foreground rr:dark:data-[state=active]:border-input rr:dark:data-[state=active]:bg-input/30 rr:dark:data-[state=active]:text-foreground",
        "rr:after:absolute rr:after:bg-foreground rr:after:opacity-0 rr:after:transition-opacity rr:group-data-[orientation=horizontal]/tabs:after:inset-x-0 rr:group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] rr:group-data-[orientation=horizontal]/tabs:after:h-0.5 rr:group-data-[orientation=vertical]/tabs:after:inset-y-0 rr:group-data-[orientation=vertical]/tabs:after:-right-1 rr:group-data-[orientation=vertical]/tabs:after:w-0.5 rr:group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("rr:flex-1 rr:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
