import { type ReactNode } from "@lynx-js/react";
import { useTheme, type ThemeColors, type ThemeTypography } from "./theme.js";

export type TextSize = (keyof ThemeTypography["sizes"]) | (string & {});
export type TextColor = (keyof ThemeColors) | (string & {});

export interface TextProps {
  size?: TextSize | undefined;
  color?: TextColor | undefined;
  weight?: "normal" | "bold" | "500" | "600" | "700" | "800" | "900" | number | undefined;
  mono?: boolean | undefined;
  truncate?: boolean | undefined;
  align?: "left" | "center" | "right" | undefined;
  lineClamp?: number | undefined;
  opacity?: number | undefined;
  className?: string | undefined;
  style?: string | undefined;
  bindtap?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  children?: ReactNode | undefined;
}

export function Text({
  size = "medium",
  color,
  weight = "normal",
  mono = false,
  truncate = false,
  align = "left",
  lineClamp,
  opacity,
  className = "",
  style = "",
  bindtap,
  onClick,
  children
}: TextProps) {
  const theme = useTheme();

  const fontSize = size in theme.typography.sizes ? theme.typography.sizes[size as keyof ThemeTypography["sizes"]] : size;
  const fontColor = color ? (color in theme.colors ? theme.colors[color as keyof ThemeColors] : color) : theme.colors.text;
  const fontFamily = mono ? theme.typography.monoFontFamily : theme.typography.fontFamily;

  let inlineStyle = `font-size:${fontSize};color:${fontColor};font-family:${fontFamily};font-weight:${weight};text-align:${align};`;

  if (truncate) {
    inlineStyle += "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  } else if (lineClamp) {
    inlineStyle += `overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:${lineClamp};-webkit-box-orient:vertical;`;
  }

  if (opacity !== undefined) inlineStyle += `opacity:${opacity};`;
  if (style) inlineStyle += style;

  const tapHandler = bindtap || onClick;

  return (
    <text className={className} style={inlineStyle} bindtap={tapHandler}>
      {children}
    </text>
  );
}

export interface HeadingProps extends TextProps {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Heading({
  level = 2,
  size,
  weight = "700",
  mono = true,
  color = "text",
  children,
  ...rest
}: HeadingProps) {
  const defaultSizes: Record<number, TextSize> = {
    1: "title",
    2: "xxlarge",
    3: "xlarge",
    4: "large",
    5: "medium",
    6: "small"
  };

  return (
    <Text size={size || defaultSizes[level] || "large"} weight={weight} mono={mono} color={color} {...rest}>
      {children}
    </Text>
  );
}

export interface ParagraphProps extends TextProps {
  fill?: boolean;
}

export function Paragraph({
  size = "medium",
  color = "textMuted",
  fill = true,
  style = "",
  children,
  ...rest
}: ParagraphProps) {
  const inlineStyle = `${fill ? "max-width:100%;" : "max-width:640px;"}line-height:1.6;${style}`;
  return (
    <Text size={size} color={color} style={inlineStyle} {...rest}>
      {children}
    </Text>
  );
}
