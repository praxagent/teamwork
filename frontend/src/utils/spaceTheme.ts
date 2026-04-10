/**
 * Per-space color theme system.
 *
 * Each space can have a `theme_hue` (0–360) that shifts all accent
 * colors while the user is inside that space.  The system works in
 * both light and dark mode by keeping saturation and lightness
 * appropriate for each mode while rotating the hue.
 *
 * Usage:
 *   const theme = getSpaceTheme(space.theme_hue, dark);
 *   <div style={theme.vars}>  // sets CSS custom properties
 *     <button className={theme.accent}>Click me</button>
 *   </div>
 *
 * Presets are provided for quick theme picking in the UI.
 */

export interface SpaceTheme {
  /** Hue value (0-360) */
  hue: number;
  /** CSS custom properties to set on a container element */
  vars: React.CSSProperties;
  /** Tailwind-compatible class strings for common accent uses */
  accent: string;
  accentHover: string;
  accentBg: string;
  accentBgSubtle: string;
  accentBorder: string;
  accentText: string;
  /** Progress bar fill color */
  progressBar: string;
}

const DEFAULT_HUE = 240; // indigo

export const THEME_PRESETS: Array<{ name: string; hue: number }> = [
  { name: 'Indigo', hue: 240 },
  { name: 'Sky', hue: 200 },
  { name: 'Emerald', hue: 155 },
  { name: 'Amber', hue: 40 },
  { name: 'Rose', hue: 350 },
  { name: 'Violet', hue: 270 },
  { name: 'Orange', hue: 25 },
  { name: 'Teal', hue: 175 },
  { name: 'Crimson', hue: 0 },
  { name: 'Lime', hue: 85 },
];

/**
 * Generate a SpaceTheme from a hue value.
 * Returns inline style vars + utility class-like strings for
 * Tailwind-style usage.
 */
export function getSpaceTheme(
  hue: number | null | undefined,
  dark: boolean,
): SpaceTheme {
  const h = hue ?? DEFAULT_HUE;

  // The theme affects the ENTIRE page when inside a space — not
  // just text, but backgrounds, borders, and cards too.  The key
  // is keeping it classy: low-opacity tints for backgrounds, not
  // full-saturation colors.  The accent stays vibrant for buttons
  // and active indicators.
  const vars: React.CSSProperties = {
    '--space-hue': `${h}`,
    // -- Accent colors (buttons, links, active states) --
    '--space-accent': dark
      ? `hsl(${h}, 70%, 65%)`
      : `hsl(${h}, 65%, 50%)`,
    '--space-accent-hover': dark
      ? `hsl(${h}, 75%, 72%)`
      : `hsl(${h}, 70%, 42%)`,
    // -- Page background — very subtle tint over the base --
    '--space-page-bg': dark
      ? `hsl(${h}, 15%, 10%)`      // dark: barely tinted near-black
      : `hsl(${h}, 30%, 98%)`,     // light: barely tinted near-white
    // -- Card / panel backgrounds — slightly more tinted --
    '--space-accent-bg': dark
      ? `hsl(${h}, 20%, 14%)`
      : `hsl(${h}, 40%, 96%)`,
    '--space-accent-bg-subtle': dark
      ? `hsla(${h}, 30%, 25%, 0.2)`
      : `hsla(${h}, 50%, 50%, 0.06)`,
    // -- Borders — pick up the hue softly --
    '--space-accent-border': dark
      ? `hsl(${h}, 20%, 22%)`
      : `hsl(${h}, 30%, 88%)`,
    // -- Text --
    '--space-accent-text': dark
      ? `hsl(${h}, 80%, 75%)`
      : `hsl(${h}, 70%, 40%)`,
    // -- Progress / fills --
    '--space-progress': dark
      ? `hsl(${h}, 60%, 55%)`
      : `hsl(${h}, 65%, 50%)`,
    // -- Chat sidebar --
    '--space-chat-bg': dark
      ? `hsl(${h}, 15%, 12%)`
      : `hsl(${h}, 25%, 97%)`,
  } as React.CSSProperties;

  return {
    hue: h,
    vars,
    accent: `text-[var(--space-accent)]`,
    accentHover: `hover:text-[var(--space-accent-hover)]`,
    accentBg: `bg-[var(--space-accent-bg)]`,
    accentBgSubtle: `bg-[var(--space-accent-bg-subtle)]`,
    accentBorder: `border-[var(--space-accent-border)]`,
    accentText: `text-[var(--space-accent-text)]`,
    progressBar: `bg-[var(--space-progress)]`,
  };
}

/**
 * For inline style usage when Tailwind arbitrary value classes
 * don't work (e.g., in style props):
 */
export function accentColor(hue: number | null | undefined, dark: boolean): string {
  const h = hue ?? DEFAULT_HUE;
  return dark
    ? `hsl(${h}, 70%, 65%)`
    : `hsl(${h}, 65%, 50%)`;
}

export function accentBgColor(hue: number | null | undefined, dark: boolean): string {
  const h = hue ?? DEFAULT_HUE;
  return dark
    ? `hsl(${h}, 50%, 20%)`
    : `hsl(${h}, 80%, 95%)`;
}

export function progressColor(hue: number | null | undefined, dark: boolean): string {
  const h = hue ?? DEFAULT_HUE;
  return dark
    ? `hsl(${h}, 60%, 55%)`
    : `hsl(${h}, 65%, 50%)`;
}
