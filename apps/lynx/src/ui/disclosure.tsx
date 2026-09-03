import { useState, type ReactNode } from "@lynx-js/react";
import { Box } from "./Box.js";
import { Text } from "./typography.js";
import { useTheme, type ThemeColors } from "./theme.js";

/**
 * Layer / Modal — overlay backdrop and dialog sheet.
 */
export interface LayerProps {
  open?: boolean | undefined;
  position?: "center" | "top" | "bottom" | "right" | "left" | undefined;
  title?: string | undefined;
  onClose?: (() => void) | undefined;
  width?: string | number | undefined;
  maxHeight?: string | number | undefined;
  className?: string | undefined;
  style?: string | undefined;
  children?: ReactNode | undefined;
}

export function Layer({
  open = true,
  position = "center",
  title,
  onClose,
  width = "480px",
  maxHeight = "80vh",
  className = "",
  style = "",
  children
}: LayerProps) {
  if (!open) return null;

  const positionAlign: Record<string, { justify: "center" | "start" | "end"; align: "center" | "start" | "end" }> = {
    center: { justify: "center", align: "center" },
    top: { justify: "start", align: "center" },
    bottom: { justify: "end", align: "center" },
    right: { justify: "center", align: "end" },
    left: { justify: "center", align: "start" }
  };

  const pos = positionAlign[position] ?? { justify: "center" as const, align: "center" as const };

  return (
    <Box
      position="fixed"
      top="0px"
      bottom="0px"
      left="0px"
      right="0px"
      zIndex={9999}
      background="surfaceOverlay"
      justify={pos.justify}
      align={pos.align}
      pad="large"
      style="backdrop-filter:blur(6px);"
      bindtap={onClose}
      onClick={onClose}
    >
      <Box
        direction="column"
        background="surface"
        border={{ color: "brand", size: "1px" }}
        round="medium"
        pad="large"
        gap="medium"
        elevation="large"
        width={width}
        maxHeight={maxHeight}
        className={className}
        style={style}
      >
        {(title || onClose) && (
          <Box direction="row" align="center" justify="between" border={{ side: "bottom", color: "borderSubtle" }} pad={{ bottom: "small" }}>
            {title && (
              <Text size="large" weight="bold" color="text" mono>
                {title}
              </Text>
            )}
            {onClose && (
              <Box bindtap={onClose} onClick={onClose} pad={{ horizontal: "small", vertical: "xxsmall" }} style="cursor:pointer;">
                <Text size="medium" color="textMuted" mono>
                  ✕
                </Text>
              </Box>
            )}
          </Box>
        )}

        <Box direction="column" overflow="auto" gap="medium">
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Accordion & AccordionPanel — expandable / collapsible disclosure sections.
 */
export interface AccordionProps {
  multiple?: boolean | undefined;
  children?: ReactNode | undefined;
}

export function Accordion({ children }: AccordionProps) {
  return (
    <Box direction="column" gap="small" width="100%">
      {children}
    </Box>
  );
}

export interface AccordionPanelProps {
  label: string;
  defaultOpen?: boolean | undefined;
  children?: ReactNode | undefined;
}

export function AccordionPanel({ label, defaultOpen = false, children }: AccordionPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggle = () => setIsOpen(!isOpen);

  return (
    <Box direction="column" border={{ color: "borderSubtle", size: "1px" }} round="small" overflow="hidden">
      <Box
        direction="row"
        align="center"
        justify="between"
        pad="medium"
        background="surfaceRaised"
        bindtap={toggle}
        onClick={toggle}
        style="cursor:pointer;"
      >
        <Text size="medium" weight="bold" color="text" mono>
          {label}
        </Text>
        <Text size="small" color="brand" mono>
          {isOpen ? "▼" : "▶"}
        </Text>
      </Box>

      {isOpen && (
        <Box direction="column" pad="medium" background="surface" border={{ side: "top", color: "borderSubtle" }}>
          {children}
        </Box>
      )}
    </Box>
  );
}

/**
 * Tabs & Tab — tabbed navigation and pane switcher.
 */
export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode | undefined;
  badge?: number | string | undefined;
}

export interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  children?: ReactNode | undefined;
}

export function Tabs({ tabs, activeId, onSelect, children }: TabsProps) {
  return (
    <Box direction="column" gap="medium" width="100%">
      <Box direction="row" align="center" gap="small" border={{ side: "bottom", color: "borderSubtle" }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const select = () => onSelect(tab.id);
          return (
            <Box
              key={tab.id}
              direction="row"
              align="center"
              gap="xxsmall"
              pad={{ horizontal: "medium", vertical: "small" }}
              border={isActive ? { side: "bottom", color: "brand", size: "2px" } : undefined}
              background={isActive ? "surfaceRaised" : "surface"}
              round="xsmall"
              bindtap={select}
              onClick={select}
              style="cursor:pointer;"
            >
              {tab.icon}
              <Text size="small" weight={isActive ? "bold" : "normal"} color={isActive ? "brand" : "textMuted"} mono>
                {tab.label}
              </Text>
              {tab.badge !== undefined && (
                <Box
                  background={isActive ? "brand" : "surfaceSubtle"}
                  round="full"
                  pad={{ horizontal: "xsmall", vertical: "none" }}
                >
                  <Text size="xsmall" weight="bold" color={isActive ? "textInverse" : "textMuted"} mono>
                    {tab.badge}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {children}
    </Box>
  );
}

/**
 * Banner / Notification — status message boxes.
 */
export interface BannerProps {
  status?: "ok" | "warn" | "error" | "info" | undefined;
  title?: string | undefined;
  message?: string | undefined;
  onClose?: (() => void) | undefined;
  children?: ReactNode | undefined;
}

export function Banner({ status = "info", title, message, onClose, children }: BannerProps) {
  const theme = useTheme();

  const statusConfigs: Record<string, { bg: string; border: string; text: keyof ThemeColors; icon: string }> = {
    ok: { bg: "rgba(0, 255, 157, 0.1)", border: theme.colors.statusOk, text: "statusOk", icon: "✓" },
    warn: { bg: "rgba(255, 184, 0, 0.1)", border: theme.colors.statusWarn, text: "statusWarn", icon: "⚠" },
    error: { bg: "rgba(255, 77, 109, 0.1)", border: theme.colors.statusError, text: "statusError", icon: "✕" },
    info: { bg: "rgba(87, 230, 255, 0.1)", border: theme.colors.statusInfo, text: "statusInfo", icon: "ℹ" }
  };

  const cfg = statusConfigs[status] ?? statusConfigs.info!;

  return (
    <Box
      direction="row"
      align="start"
      justify="between"
      background={cfg.bg}
      border={{ color: cfg.border, size: "1px" }}
      round="small"
      pad="medium"
      gap="small"
      width="100%"
    >
      <Box direction="row" align="start" gap="small" flex="grow">
        <Text size="large" weight="bold" color={cfg.text} mono>
          {cfg.icon}
        </Text>

        <Box direction="column" gap="xxsmall" flex="grow">
          {title && (
            <Text size="medium" weight="bold" color={cfg.text} mono>
              {title}
            </Text>
          )}
          {message && (
            <Text size="small" color="text">
              {message}
            </Text>
          )}
          {children}
        </Box>
      </Box>

      {onClose && (
        <Box bindtap={onClose} onClick={onClose} pad={{ horizontal: "xsmall" }} style="cursor:pointer;">
          <Text size="small" color="textMuted">
            ✕
          </Text>
        </Box>
      )}
    </Box>
  );
}
