import { Children, type ReactNode } from "@lynx-js/react";
import { Box, type BoxProps } from "./Box.js";

/**
 * Stack — positions child elements in a layered stack (layers on top of each other).
 */
export interface StackProps {
  interactiveChild?: "first" | "last" | "all" | undefined;
  fill?: boolean | undefined;
  className?: string | undefined;
  style?: string | undefined;
  children?: ReactNode | undefined;
}

export function Stack({ fill = true, className = "", style = "", children }: StackProps) {
  return (
    <Box
      position="relative"
      width={fill ? "100%" : undefined}
      height={fill ? "100%" : undefined}
      className={className}
      style={style}
    >
      {children}
    </Box>
  );
}

/**
 * Grid — responsive multi-column layout.
 */
export interface GridProps extends BoxProps {
  columns?: number | string | undefined;
}

export function Grid({ columns = 2, gap = "medium", children, direction = "row", wrap = true, style = "", ...rest }: GridProps) {
  const colCount = typeof columns === "number" ? columns : 2;
  const colWidth = `${Math.floor(100 / colCount)}%`;
  return (
    <Box direction={direction} wrap={wrap} gap={gap} style={style} {...rest}>
      {Children.map(children, (child) => {
        if (!child) return null;
        return (
          <Box style={`width:${colWidth};box-sizing:border-box;`}>
            {child}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Header — semantic top bar layout.
 */
export function Header({
  direction = "row",
  align = "center",
  justify = "between",
  pad = { horizontal: "large", vertical: "medium" },
  background = "surface",
  border = { side: "bottom", color: "borderSubtle" },
  children,
  ...rest
}: BoxProps) {
  return (
    <Box direction={direction} align={align} justify={justify} pad={pad} background={background} border={border} {...rest}>
      {children}
    </Box>
  );
}

/**
 * Footer — semantic bottom bar layout.
 */
export function Footer({
  direction = "row",
  align = "center",
  justify = "between",
  pad = { horizontal: "large", vertical: "medium" },
  background = "surface",
  border = { side: "top", color: "borderSubtle" },
  children,
  ...rest
}: BoxProps) {
  return (
    <Box direction={direction} align={align} justify={justify} pad={pad} background={background} border={border} {...rest}>
      {children}
    </Box>
  );
}

/**
 * Nav — navigation bar wrapper.
 */
export function Nav({ direction = "row", align = "center", gap = "small", children, ...rest }: BoxProps) {
  return (
    <Box direction={direction} align={align} gap={gap} {...rest}>
      {children}
    </Box>
  );
}

/**
 * Sidebar — semantic vertical navigation or tool sidebar.
 */
export function Sidebar({
  direction = "column",
  width = "240px",
  pad = "medium",
  background = "surface",
  border = { side: "right", color: "borderSubtle" },
  children,
  ...rest
}: BoxProps) {
  return (
    <Box direction={direction} width={width} pad={pad} background={background} border={border} {...rest}>
      {children}
    </Box>
  );
}
