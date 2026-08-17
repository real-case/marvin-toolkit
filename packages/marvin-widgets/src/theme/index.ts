/**
 * The marvin widget theme module (ADR-0024 family restyle) — the single import
 * surface for the token stylesheet, the `MvRoot` boundary component, and the
 * token-reference constants widgets use in inline styles.
 *
 *   import { MvRoot, TOKENS, SEVERITY_TOKENS, BAR_TOKENS } from "../../theme";
 */
export { MvRoot, ensureMvThemeStyles, type MvRootProps } from "./MvRoot";
export {
  MV_ROOT_CLASS,
  MV_STYLE_ELEMENT_ID,
  MV_THEME_CSS,
  MV_FONT_SANS,
  MV_FONT_MONO,
  TOKENS,
  SEVERITY_TOKENS,
  BAR_TOKENS,
  type MvTheme,
  type MvTokenName,
  type MvSeverityToken,
  type MvBarToken,
} from "./tokens";
