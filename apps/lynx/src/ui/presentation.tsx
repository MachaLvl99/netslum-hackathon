import { type ReactNode } from "@lynx-js/react";
import { Box, type BoxProps } from "./Box.js";
import { Text } from "./typography.js";
import { useTheme, type ThemeColors } from "./theme.js";
/**
 * Card — structured content container with border and elevation.
 */
export interface CardProps extends BoxProps {
  interactive?: boolean | undefined;
}

export function Card({
  background = "surface",
  border = true,
  round = "medium",
  pad = "large",
  gap = "medium",
  elevation = "small",
  children,
  ...rest
}: CardProps) {
  return (
    <Box
      background={background}
      border={border}
      round={round}
      pad={pad}
      gap={gap}
      elevation={elevation}
      {...rest}
    >
      {children}
    </Box>
  );
}

export function CardHeader({
  direction = "row",
  align = "center",
  justify = "between",
  gap = "small",
  children,
  ...rest
}: BoxProps) {
  return (
    <Box direction={direction} align={align} justify={justify} gap={gap} {...rest}>
      {children}
    </Box>
  );
}

export function CardBody({
  direction = "column",
  gap = "small",
  children,
  ...rest
}: BoxProps) {
  return (
    <Box direction={direction} gap={gap} {...rest}>
      {children}
    </Box>
  );
}

export function CardFooter({
  direction = "row",
  align = "center",
  justify = "between",
  gap = "small",
  children,
  ...rest
}: BoxProps) {
  return (
    <Box direction={direction} align={align} justify={justify} gap={gap} {...rest}>
      {children}
    </Box>
  );
}

/**
 * Avatar — user/agent avatar with initials fallback and presence indicator.
 */
export type AvatarSize = "xsmall" | "small" | "medium" | "large" | "xlarge" | number;

export interface AvatarProps {
  src?: string | undefined;
  alt?: string | undefined;
  name?: string | undefined;
  size?: AvatarSize | undefined;
  status?: "online" | "offline" | "busy" | undefined;
  round?: "full" | "medium" | "small" | undefined;
  className?: string | undefined;
  style?: string | undefined;
  bindtap?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
}

export function Avatar({
  src,
  name,
  size = "medium",
  status,
  round = "full",
  className = "",
  style = "",
  bindtap,
  onClick
}: AvatarProps) {
  const sizePixels: Record<string, number> = {
    xsmall: 20,
    small: 28,
    medium: 36,
    large: 48,
    xlarge: 64
  };

  const px = typeof size === "number" ? size : sizePixels[size] || 36;
  const radius = round === "full" ? "9999px" : round === "medium" ? "6px" : "4px";

  const initials = name
    ? name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "@";

  return (
    <Box
      position="relative"
      width={`${px}px`}
      height={`${px}px`}
      round={round}
      background="surfaceRaised"
      border={{ color: "borderSubtle" }}
      align="center"
      justify="center"
      overflow="hidden"
      className={className}
      style={style}
      bindtap={bindtap}
      onClick={onClick}
    >
      {src ? (
        <image
          src={src}
          style={`width:${px}px;height:${px}px;border-radius:${radius};object-fit:cover;`}
        />
      ) : (
        <Text size={px < 28 ? "xsmall" : "small"} weight="bold" color="brand" mono>
          {initials}
        </Text>
      )}

      {status && (
        <Box
          position="absolute"
          bottom="0px"
          right="0px"
          width="8px"
          height="8px"
          round="full"
          background={status === "online" ? "statusOk" : status === "busy" ? "statusWarn" : "textSubtle"}
          border={{ color: "background", size: "1px" }}
        />
      )}
    </Box>
  );
}

/**
 * Badge — indicator pill for counters, status, or tags.
 */
export interface BadgeProps {
  value?: number | string | undefined;
  variant?: "brand" | "ok" | "warn" | "error" | "info" | "neutral" | undefined;
  size?: "small" | "medium" | undefined;
  className?: string | undefined;
  style?: string | undefined;
  children?: ReactNode | undefined;
}

export function Badge({
  value,
  variant = "brand",
  size = "small",
  className = "",
  style = "",
  children
}: BadgeProps) {
  const theme = useTheme();

  const variantColors: Record<string, { bg: string; text: string; border: string }> = {
    brand: { bg: theme.colors.brandGlow, text: theme.colors.brand, border: theme.colors.brand },
    ok: { bg: "rgba(0, 255, 157, 0.15)", text: theme.colors.statusOk, border: theme.colors.statusOk },
    warn: { bg: "rgba(255, 184, 0, 0.15)", text: theme.colors.statusWarn, border: theme.colors.statusWarn },
    error: { bg: "rgba(255, 77, 109, 0.15)", text: theme.colors.statusError, border: theme.colors.statusError },
    info: { bg: "rgba(87, 230, 255, 0.15)", text: theme.colors.statusInfo, border: theme.colors.statusInfo },
    neutral: { bg: theme.colors.surfaceRaised, text: theme.colors.textMuted, border: theme.colors.border }
  };
  const current = variantColors[variant] ?? { bg: theme.colors.brandGlow, text: theme.colors.brand, border: theme.colors.brand };
  if (children) {
    return (
      <Box position="relative" className={className} style={style}>
        {children}
        {value !== undefined && (
          <Box
            position="absolute"
            top="-6px"
            right="-8px"
            background={current.bg}
            border={{ color: current.border, size: "1px" }}
            round="full"
            pad={{ horizontal: "xsmall", vertical: "none" }}
            minWidth="16px"
            height="16px"
            align="center"
            justify="center"
          >
            <Text size="xsmall" weight="bold" color={current.text as keyof ThemeColors} mono>
              {typeof value === "number" && value > 99 ? "99+" : value}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      background={current.bg}
      border={{ color: current.border, size: "1px" }}
      round="full"
      pad={size === "small" ? { horizontal: "small", vertical: "xxsmall" } : { horizontal: "medium", vertical: "xsmall" }}
      align="center"
      justify="center"
      className={className}
      style={style}
    >
      <Text size={size === "small" ? "xsmall" : "small"} weight="bold" color={current.text as keyof ThemeColors} mono>
        {value}
      </Text>
    </Box>
  );
}

/**
 * Spinner — animated cyber loading indicator.
 */
export interface SpinnerProps {
  size?: "small" | "medium" | "large" | undefined;
  color?: (keyof ThemeColors) | (string & {}) | undefined;
  className?: string | undefined;
  style?: string | undefined;
}

export function Spinner({ size = "medium", color = "brand", className = "", style = "" }: SpinnerProps) {
  const px = size === "small" ? 14 : size === "large" ? 28 : 20;
  return (
    <Box
      width={`${px}px`}
      height={`${px}px`}
      align="center"
      justify="center"
      className={`netslum-spinner ${className}`}
      style={`animation:spin 1s linear infinite;${style}`}
    >
      <Text size={size === "small" ? "small" : "large"} color={color} mono>
        ◐
      </Text>
    </Box>
  );
}

/**
 * Divider — subtle horizontal or vertical line.
 */
export interface DividerProps {
  orientation?: "horizontal" | "vertical" | undefined;
  color?: (keyof ThemeColors) | (string & {}) | undefined;
  margin?: string | undefined;
  style?: string | undefined;
}

export function Divider({
  orientation = "horizontal",
  color = "borderSubtle",
  margin = "small",
  style = ""
}: DividerProps) {
  if (orientation === "vertical") {
    return (
      <Box
        width="1px"
        height="100%"
        background={color}
        pad={{ horizontal: margin }}
        style={style}
      />
    );
  }

  return (
    <Box
      width="100%"
      height="1px"
      background={color}
      pad={{ vertical: margin }}
      style={style}
    />
  );
}

/**
 * Tag / Chip — clickable or dismissible metadata pill.
 */
export interface TagProps {
  label: string;
  onDismiss?: (() => void) | undefined;
  bindtap?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  selected?: boolean | undefined;
}

export function Tag({ label, onDismiss, bindtap, onClick, selected = false }: TagProps) {
  return (
    <Box
      direction="row"
      align="center"
      gap="xxsmall"
      background={selected ? "brandGlow" : "surfaceRaised"}
      border={{ color: selected ? "brand" : "border" }}
      round="small"
      pad={{ horizontal: "small", vertical: "xxsmall" }}
      bindtap={bindtap}
      onClick={onClick}
    >
      <Text size="small" color={selected ? "brand" : "textMuted"} mono>
        {label}
      </Text>
      {onDismiss && (
        <Box bindtap={onDismiss} pad={{ left: "xxsmall" }}>
          <Text size="small" color="textSubtle">
            ✕
          </Text>
        </Box>
      )}
    </Box>
  );
}
