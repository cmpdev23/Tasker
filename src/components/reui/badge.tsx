import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import Image from "next/image"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "relative inline-flex h-5 min-w-5 w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-[26px] border border-solid px-2 py-0.5 text-xs font-medium leading-4 normal-case shadow-[0_1px_1px_0_rgba(63,61,61,0.2)] outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3",
  ],
  {
    variants: {
      tone: {
        default: "border-[#090909] bg-[#f4f4f5] text-black",
        secondary: "border-[#090909] bg-[#a1a1aa] text-black",
        outline:
          "border-[#18181b] bg-transparent text-[#18181b] dark:border-[#f4f4f5] dark:text-[#f4f4f5]",
        neutral: "border-[#090909] bg-[#bfdbfe] text-[#171717]",
        info: "border-[#090909] bg-[#a7f3d0] text-[#171717]",
        success: "border-[#090909] bg-[#bef264] text-[#171717]",
        warning: "border-[#090909] bg-[#fde047] text-[#171717]",
        destructive: "border-[#090909] bg-[#f87171] text-[#171717]",
        rose: "border-[#090909] bg-[#ffe4e6] text-[#171717]",
        fuchsia: "border-[#090909] bg-[#f5d0fe] text-[#171717]",
        purple: "border-[#090909] bg-[#d8b4fe] text-[#171717]",
        violet: "border-[#090909] bg-[#c4b5fd] text-[#171717]",
        indigo: "border-[#090909] bg-[#a5b4fc] text-[#171717]",
        blue: "border-[#090909] bg-[#93c5fd] text-[#171717]",
        cyan: "border-[#090909] bg-[#a5f3fc] text-[#171717]",
        orange: "border-[#090909] bg-[#fdba74] text-[#171717]",
        amber: "border-[#090909] bg-[#fde68a] text-[#171717]",
      },
      variant: {
        default: "",
        dot: "gap-1 border-[#090909] bg-[#f4f4f5] text-[#171717]",
        "dot-dark": "gap-1 border-[#18181b] bg-[#0c0a09] text-white",
        "dot-outline":
          "gap-1 border-[#18181b] bg-background text-[#18181b] dark:text-white",
      },
    },
    defaultVariants: {
      tone: "default",
      variant: "dot-outline",
    },
  }
)

type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>
type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>

const DOT_ASSETS: Record<BadgeTone, string> = {
  default: "/assets/badges/dot-neutral.svg",
  secondary: "/assets/badges/dot-neutral.svg",
  outline: "/assets/badges/dot-neutral.svg",
  neutral: "/assets/badges/dot-neutral.svg",
  info: "/assets/badges/dot-info.svg",
  success: "/assets/badges/dot-success.svg",
  warning: "/assets/badges/dot-warning.svg",
  destructive: "/assets/badges/dot-destructive.svg",
  rose: "/assets/badges/dot-destructive.svg",
  fuchsia: "/assets/badges/dot-purple.svg",
  purple: "/assets/badges/dot-purple.svg",
  violet: "/assets/badges/dot-violet.svg",
  indigo: "/assets/badges/dot-violet.svg",
  blue: "/assets/badges/dot-neutral.svg",
  cyan: "/assets/badges/dot-cyan.svg",
  orange: "/assets/badges/dot-warning.svg",
  amber: "/assets/badges/dot-warning.svg",
}

interface BadgeProps extends useRender.ComponentProps<"span"> {
  tone?: BadgeTone
  variant?: BadgeVariant
}

function Badge({
  className,
  tone = "default",
  variant = "dot-outline",
  render,
  children,
  ...props
}: BadgeProps) {
  const hasDot = variant !== "default"
  const defaultProps = {
    "data-slot": "badge",
    className: cn(badgeVariants({ tone, variant, className })),
    children: (
      <>
        {hasDot ? (
          <Image
            src={DOT_ASSETS[tone]}
            alt=""
            aria-hidden="true"
            width={8}
            height={8}
            unoptimized
            className="size-2 shrink-0"
          />
        ) : null}
        {children}
      </>
    ),
  }

  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(defaultProps, props),
  })
}

export {
  Badge,
  badgeVariants,
  type BadgeProps,
  type BadgeTone,
  type BadgeVariant,
}
