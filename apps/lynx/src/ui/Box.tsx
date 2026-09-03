import { type ReactNode } from "@lynx-js/react";
import { useTheme, type Theme, type ThemeColors, type ThemeRadius, type ThemeSpacing } from "./theme.js";

export type PadSize = keyof ThemeSpacing | (string & {});
export type PadProp =
  | PadSize
  | {
      horizontal?: PadSize | undefined;
      vertical?: PadSize | undefined;
      top?: PadSize | undefined;
      bottom?: PadSize | undefined;
      left?: PadSize | undefined;
      right?: PadSize | undefined;
    };

export type GapSize = keyof ThemeSpacing | (string & {});
export type RoundSize = keyof ThemeRadius | (string & {});
export type ColorProp = (keyof ThemeColors) | (string & {});

export interface BorderConfig {
  color?: ColorProp | undefined;
  size?: string | undefined;
  side?: "all" | "top" | "bottom" | "left" | "right" | "horizontal" | "vertical" | undefined;
  style?: "solid" | "dashed" | "dotted" | undefined;
}

export interface BoxProps {
  direction?: "row" | "column" | "row-reverse" | "column-reverse" | undefined;
  pad?: PadProp | undefined;
  gap?: GapSize | undefined;
  align?: "start" | "center" | "end" | "stretch" | "baseline" | undefined;
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly" | undefined;
  wrap?: boolean | "reverse" | undefined;
  background?: ColorProp | undefined;
  border?: boolean | BorderConfig | undefined;
  round?: RoundSize | undefined;
  elevation?: keyof Theme["elevation"] | (string & {}) | undefined;
  width?: string | number | undefined;
  height?: string | number | undefined;
  minWidth?: string | number | undefined;
  minHeight?: string | number | undefined;
  maxWidth?: string | number | undefined;
  maxHeight?: string | number | undefined;
  flex?: boolean | "grow" | "shrink" | number | { grow?: number | undefined; shrink?: number | undefined; basis?: string | undefined } | undefined;
  overflow?: "visible" | "hidden" | "scroll" | "auto" | undefined;
  position?: "relative" | "absolute" | "fixed" | undefined;
  top?: string | number | undefined;
  bottom?: string | number | undefined;
  left?: string | number | undefined;
  right?: string | number | undefined;
  zIndex?: number | undefined;
  opacity?: number | undefined;
  className?: string | undefined;
  style?: string | Record<string, unknown> | undefined;
  bindtap?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  children?: ReactNode | undefined;
}

function resolveColor(theme: Theme, color?: ColorProp): string | undefined {
  if (!color) return undefined;
  if (color in theme.colors) return theme.colors[color as keyof ThemeColors];
  return color;
}

function resolveSpacing(theme: Theme, size?: PadSize): string | undefined {
  if (!size) return undefined;
  if (size in theme.spacing) return theme.spacing[size as keyof ThemeSpacing];
  return size;
}

function resolveRadius(theme: Theme, round?: RoundSize): string | undefined {
  if (!round) return undefined;
  if (round in theme.radii) return theme.radii[round as keyof ThemeRadius];
  return round;
}

export function Box({
  direction = "column",
  pad,
  gap,
  align,
  justify,
  wrap,
  background,
  border,
  round,
  elevation,
  width,
  height,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  flex,
  overflow,
  position,
  top,
  bottom,
  left,
  right,
  zIndex,
  opacity,
  className = "",
  style = "",
  bindtap,
  onClick,
  children
}: BoxProps) {
  const theme = useTheme();

  let inlineStyle = `display:flex;flex-direction:${direction};`;

  // Flexbox
  if (align) {
    const alignMap: Record<string, string> = {
      start: "flex-start",
      center: "center",
      end: "flex-end",
      stretch: "stretch",
      baseline: "baseline"
    };
    const aVal = alignMap[align] ?? align;
    inlineStyle += `align-items:${aVal};`;
  }
  if (justify) {
    const justifyMap: Record<string, string> = {
      start: "flex-start",
      center: "center",
      end: "flex-end",
      between: "space-between",
      around: "space-around",
      evenly: "space-evenly"
    };
    const jVal = justifyMap[justify] ?? justify;
    inlineStyle += `justify-content:${jVal};`;
  }
  if (wrap) {
    inlineStyle += `flex-wrap:${wrap === "reverse" ? "wrap-reverse" : "wrap"};`;
  }

  // Gap
  if (gap) {
    const gapVal = resolveSpacing(theme, gap);
    if (gapVal) inlineStyle += `gap:${gapVal};`;
  }

  // Padding
  if (pad) {
    if (typeof pad === "string" || typeof pad === "number") {
      const padVal = resolveSpacing(theme, pad);
      if (padVal) inlineStyle += `padding:${padVal};`;
    } else {
      if (pad.horizontal) {
        const hVal = resolveSpacing(theme, pad.horizontal);
        if (hVal) inlineStyle += `padding-left:${hVal};padding-right:${hVal};`;
      }
      if (pad.vertical) {
        const vVal = resolveSpacing(theme, pad.vertical);
        if (vVal) inlineStyle += `padding-top:${vVal};padding-bottom:${vVal};`;
      }
      if (pad.top) {
        const val = resolveSpacing(theme, pad.top);
        if (val) inlineStyle += `padding-top:${val};`;
      }
      if (pad.bottom) {
        const val = resolveSpacing(theme, pad.bottom);
        if (val) inlineStyle += `padding-bottom:${val};`;
      }
      if (pad.left) {
        const val = resolveSpacing(theme, pad.left);
        if (val) inlineStyle += `padding-left:${val};`;
      }
      if (pad.right) {
        const val = resolveSpacing(theme, pad.right);
        if (val) inlineStyle += `padding-right:${val};`;
      }
    }
  }

  // Background
  if (background) {
    const bgVal = resolveColor(theme, background);
    if (bgVal) inlineStyle += `background-color:${bgVal};`;
  }

  // Border
  if (border) {
    if (border === true) {
      inlineStyle += `border:1px solid ${theme.colors.border};`;
    } else {
      const bColor = resolveColor(theme, border.color) || theme.colors.border;
      const bSize = border.size || "1px";
      const bStyle = border.style || "solid";
      const bSide = border.side || "all";

      if (bSide === "all") inlineStyle += `border:${bSize} ${bStyle} ${bColor};`;
      else if (bSide === "top") inlineStyle += `border-top:${bSize} ${bStyle} ${bColor};`;
      else if (bSide === "bottom") inlineStyle += `border-bottom:${bSize} ${bStyle} ${bColor};`;
      else if (bSide === "left") inlineStyle += `border-left:${bSize} ${bStyle} ${bColor};`;
      else if (bSide === "right") inlineStyle += `border-right:${bSize} ${bStyle} ${bColor};`;
      else if (bSide === "horizontal") inlineStyle += `border-top:${bSize} ${bStyle} ${bColor};border-bottom:${bSize} ${bStyle} ${bColor};`;
      else if (bSide === "vertical") inlineStyle += `border-left:${bSize} ${bStyle} ${bColor};border-right:${bSize} ${bStyle} ${bColor};`;
    }
  }

  // Round / BorderRadius
  if (round) {
    const rVal = resolveRadius(theme, round);
    if (rVal) inlineStyle += `border-radius:${rVal};`;
  }

  // Elevation / Shadow
  if (elevation) {
    const shadowVal = elevation in theme.elevation ? theme.elevation[elevation as keyof Theme["elevation"]] : elevation;
    if (shadowVal && shadowVal !== "none") inlineStyle += `box-shadow:${shadowVal};`;
  }

  // Sizing
  if (width !== undefined) inlineStyle += `width:${typeof width === "number" ? `${width}px` : width};`;
  if (height !== undefined) inlineStyle += `height:${typeof height === "number" ? `${height}px` : height};`;
  if (minWidth !== undefined) inlineStyle += `min-width:${typeof minWidth === "number" ? `${minWidth}px` : minWidth};`;
  if (minHeight !== undefined) inlineStyle += `min-height:${typeof minHeight === "number" ? `${minHeight}px` : minHeight};`;
  if (maxWidth !== undefined) inlineStyle += `max-width:${typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth};`;
  if (maxHeight !== undefined) inlineStyle += `max-height:${typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight};`;

  // Flex props
  if (flex !== undefined) {
    if (typeof flex === "boolean") {
      inlineStyle += flex ? "flex:1 1 auto;" : "flex:0 0 auto;";
    } else if (flex === "grow") {
      inlineStyle += "flex-grow:1;";
    } else if (flex === "shrink") {
      inlineStyle += "flex-shrink:1;";
    } else if (typeof flex === "number") {
      inlineStyle += `flex:${flex};`;
    } else if (typeof flex === "object") {
      if (flex.grow !== undefined) inlineStyle += `flex-grow:${flex.grow};`;
      if (flex.shrink !== undefined) inlineStyle += `flex-shrink:${flex.shrink};`;
      if (flex.basis !== undefined) inlineStyle += `flex-basis:${flex.basis};`;
    }
  }

  // Overflow
  if (overflow) inlineStyle += `overflow:${overflow};`;

  // Position
  if (position) inlineStyle += `position:${position};`;
  if (top !== undefined) inlineStyle += `top:${typeof top === "number" ? `${top}px` : top};`;
  if (bottom !== undefined) inlineStyle += `bottom:${typeof bottom === "number" ? `${bottom}px` : bottom};`;
  if (left !== undefined) inlineStyle += `left:${typeof left === "number" ? `${left}px` : left};`;
  if (right !== undefined) inlineStyle += `right:${typeof right === "number" ? `${right}px` : right};`;
  if (zIndex !== undefined) inlineStyle += `z-index:${zIndex};`;
  if (opacity !== undefined) inlineStyle += `opacity:${opacity};`;

  // Merge with custom style
  if (typeof style === "string") {
    inlineStyle += style;
  }

  const tapHandler = bindtap || onClick;

  return (
    <view className={className} style={inlineStyle} bindtap={tapHandler}>
      {children}
    </view>
  );
}
