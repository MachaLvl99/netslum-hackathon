import { type ReactNode } from "@lynx-js/react";
import { Box, type BoxProps } from "./Box.js";
import { Text } from "./typography.js";
import { Spinner } from "./presentation.js";
import { useTheme, type ThemeColors } from "./theme.js";

/**
 * Button — Grommet-like button with primary, secondary, danger, ghost, and subtle variants.
 */
export interface ButtonProps {
  label?: string | undefined;
  icon?: ReactNode | undefined;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "subtle" | undefined;
  size?: "small" | "medium" | "large" | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  fill?: boolean | undefined;
  className?: string | undefined;
  style?: string | undefined;
  bindtap?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  children?: ReactNode | undefined;
}

export function Button({
  label,
  icon,
  variant = "secondary",
  size = "medium",
  disabled = false,
  loading = false,
  fill = false,
  className = "",
  style = "",
  bindtap,
  onClick,
  children
}: ButtonProps) {
  const theme = useTheme();

  const variantStyles: Record<string, { bg: (keyof ThemeColors) | (string & {}); border: (keyof ThemeColors) | (string & {}); text: (keyof ThemeColors) | (string & {}) }> = {
    primary: { bg: theme.colors.brand, border: theme.colors.brand, text: theme.colors.textInverse },
    secondary: { bg: theme.colors.surfaceSubtle, border: theme.colors.border, text: theme.colors.text },
    danger: { bg: "rgba(255, 77, 109, 0.15)", border: theme.colors.statusError, text: theme.colors.statusError },
    ghost: { bg: "transparent", border: "transparent", text: theme.colors.brand },
    subtle: { bg: theme.colors.surfaceRaised, border: "transparent", text: theme.colors.textMuted }
  };

  const v = variantStyles[variant] ?? { bg: theme.colors.surfaceSubtle, border: theme.colors.border, text: theme.colors.text };

  const padSizes: Record<string, BoxProps["pad"]> = {
    small: { horizontal: "small", vertical: "xxsmall" },
    medium: { horizontal: "large", vertical: "small" },
    large: { horizontal: "xlarge", vertical: "medium" }
  };

  const textSizes: Record<string, "xsmall" | "small" | "medium" | "large"> = {
    small: "small",
    medium: "medium",
    large: "large"
  };

  const tapHandler = !disabled && !loading ? bindtap || onClick : undefined;

  return (
    <Box
      direction="row"
      align="center"
      justify="center"
      gap="small"
      pad={padSizes[size]}
      background={v.bg}
      border={{ color: v.border, size: "1px" }}
      round="small"
      width={fill ? "100%" : undefined}
      opacity={disabled ? 0.45 : 1}
      className={className}
      style={`cursor:${disabled ? "not-allowed" : "pointer"};${style}`}
      bindtap={tapHandler}
      onClick={tapHandler}
    >
      {loading ? (
        <Spinner size="small" color={v.text} />
      ) : (
        icon
      )}

      {label && (
        <Text size={textSizes[size] || "medium"} weight="bold" color={v.text} mono>
          {label}
        </Text>
      )}

      {children}
    </Box>
  );
}

/**
 * TextInput — styled input container with icon and validation states.
 */
export interface TextInputProps {
  value?: string | undefined;
  placeholder?: string | undefined;
  prefix?: ReactNode | undefined;
  suffix?: ReactNode | undefined;
  error?: string | boolean | undefined;
  disabled?: boolean | undefined;
  type?: "text" | "password" | "number" | undefined;
  className?: string | undefined;
  style?: string | undefined;
  bindinput?: ((e: { detail?: { value?: string } }) => void) | undefined;
  onInput?: ((value: string) => void) | undefined;
  onChange?: ((value: string) => void) | undefined;
}

export function TextInput({
  value,
  placeholder = "",
  prefix,
  suffix,
  error,
  disabled = false,
  type = "text",
  className = "",
  style = "",
  bindinput,
  onInput,
  onChange
}: TextInputProps) {
  const theme = useTheme();

  const handleInput = (e: { detail?: { value?: string } }) => {
    const val = e.detail?.value ?? "";
    if (bindinput) bindinput(e);
    if (onInput) onInput(val);
    if (onChange) onChange(val);
  };

  return (
    <Box
      direction="row"
      align="center"
      background="surface"
      border={{ color: error ? "statusError" : "border", size: "1px" }}
      round="small"
      pad={{ horizontal: "medium", vertical: "small" }}
      gap="small"
      opacity={disabled ? 0.5 : 1}
      className={className}
      style={style}
    >
      {prefix}

      <input
        type={type}
        default-value={value}
        placeholder={placeholder}
        disabled={disabled}
        bindinput={handleInput}
        style={`flex:1;background:transparent;border:none;outline:none;color:${theme.colors.text};font-family:${theme.typography.monoFontFamily};font-size:${theme.typography.sizes.medium};`}
      />

      {suffix}
    </Box>
  );
}

/**
 * TextArea — multiline text input with character count.
 */
export interface TextAreaProps {
  value?: string | undefined;
  placeholder?: string | undefined;
  rows?: number | undefined;
  maxLength?: number | undefined;
  error?: string | boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  style?: string | undefined;
  bindinput?: ((e: { detail?: { value?: string } }) => void) | undefined;
  onInput?: ((value: string) => void) | undefined;
}

export function TextArea({
  value = "",
  placeholder = "",
  rows = 4,
  maxLength,
  error,
  disabled = false,
  className = "",
  style = "",
  bindinput,
  onInput
}: TextAreaProps) {
  const theme = useTheme();

  const handleInput = (e: { detail?: { value?: string } }) => {
    const val = e.detail?.value ?? "";
    if (bindinput) bindinput(e);
    if (onInput) onInput(val);
  };

  return (
    <Box
      direction="column"
      background="surface"
      border={{ color: error ? "statusError" : "border", size: "1px" }}
      round="small"
      pad="medium"
      gap="xsmall"
      opacity={disabled ? 0.5 : 1}
      className={className}
      style={style}
    >
      <input
        default-value={value}
        placeholder={placeholder}
        disabled={disabled}
        bindinput={handleInput}
        style={`width:100%;min-height:${rows * 20}px;background:transparent;border:none;outline:none;color:${theme.colors.text};font-family:${theme.typography.monoFontFamily};font-size:${theme.typography.sizes.medium};`}
      />

      {maxLength && (
        <Box align="end">
          <Text size="xsmall" color={value.length > maxLength * 0.9 ? "statusWarn" : "textSubtle"} mono>
            {value.length}/{maxLength}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * CheckBox — cyber checkbox with check icon.
 */
export interface CheckBoxProps {
  label?: string | undefined;
  checked?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
  bindtap?: (() => void) | undefined;
}

export function CheckBox({ label, checked = false, disabled = false, onChange, bindtap }: CheckBoxProps) {
  const toggle = () => {
    if (disabled) return;
    if (onChange) onChange(!checked);
    if (bindtap) bindtap();
  };

  return (
    <Box
      direction="row"
      align="center"
      gap="small"
      opacity={disabled ? 0.5 : 1}
      style="cursor:pointer;"
      bindtap={toggle}
      onClick={toggle}
    >
      <Box
        width="18px"
        height="18px"
        round="xsmall"
        background={checked ? "brand" : "surfaceRaised"}
        border={{ color: checked ? "brand" : "border", size: "1px" }}
        align="center"
        justify="center"
      >
        {checked && (
          <Text size="small" weight="bold" color="textInverse" mono>
            ✓
          </Text>
        )}
      </Box>

      {label && (
        <Text size="medium" color="text" mono>
          {label}
        </Text>
      )}
    </Box>
  );
}

/**
 * Switch — toggle switch control.
 */
export interface SwitchProps {
  label?: string | undefined;
  checked?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
}

export function Switch({ label, checked = false, disabled = false, onChange }: SwitchProps) {
  const toggle = () => {
    if (disabled) return;
    if (onChange) onChange(!checked);
  };

  return (
    <Box
      direction="row"
      align="center"
      gap="small"
      opacity={disabled ? 0.5 : 1}
      style="cursor:pointer;"
      bindtap={toggle}
      onClick={toggle}
    >
      <Box
        width="36px"
        height="20px"
        round="full"
        background={checked ? "brand" : "surfaceRaised"}
        border={{ color: checked ? "brand" : "border", size: "1px" }}
        position="relative"
        pad="xxsmall"
      >
        <Box
          position="absolute"
          top="2px"
          left={checked ? "18px" : "2px"}
          width="14px"
          height="14px"
          round="full"
          background={checked ? "textInverse" : "textMuted"}
          style="transition:left 0.2s ease;"
        />
      </Box>

      {label && (
        <Text size="medium" color="text" mono>
          {label}
        </Text>
      )}
    </Box>
  );
}

/**
 * FormField — label, description, and error wrapper for form inputs.
 */
export interface FormFieldProps {
  label?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children?: ReactNode | undefined;
}

export function FormField({ label, description, error, required = false, children }: FormFieldProps) {
  return (
    <Box direction="column" gap="xxsmall" width="100%">
      {label && (
        <Box direction="row" gap="xxsmall">
          <Text size="small" weight="bold" color="text" mono>
            {label}
          </Text>
          {required && (
            <Text size="small" color="statusError">
              *
            </Text>
          )}
        </Box>
      )}

      {description && (
        <Text size="xsmall" color="textMuted">
          {description}
        </Text>
      )}

      {children}

      {error && (
        <Text size="xsmall" color="statusError" mono>
          ⚠ {error}
        </Text>
      )}
    </Box>
  );
}

/**
 * Form — form layout container.
 */
export interface FormProps {
  onSubmit?: (() => void) | undefined;
  children?: ReactNode | undefined;
}

export function Form({ children }: FormProps) {
  return (
    <Box direction="column" gap="large" width="100%">
      {children}
    </Box>
  );
}
