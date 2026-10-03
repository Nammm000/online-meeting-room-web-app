import type { Role } from "model/user.model";
import type { TranslationKey } from "i18n/translations";

export interface Menu {
  path: string; // route path without leading slash
  labelKey: TranslationKey; // dictionary key; en/vi text lives in i18n/translations
  description: string; // shown on the dashboard quick links
  icon: string; // glyph class from src/scss/icon.scss, rendered as `icon-18 {icon}`
  /** '' = any authenticated user; 'ROLE_ADMIN' = admins only. */
  role: "" | "ROLE_ADMIN";
  /** false = keep this link highlighted on child routes too (e.g. a meeting room under /meetings). */
  exact?: boolean;
}

const MENU_ITEMS: Menu[] = [
  {
    path: "dashboard",
    labelKey: "menu.dashboard",
    description: "Overview and quick access to your assets.",
    icon: "grid",
    role: "",
  },
  {
    path: "meetings",
    labelKey: "menu.meetings",
    description: "Create, join and manage your meetings.",
    icon: "video",
    role: "",
    exact: false,
  },
  {
    path: "pdf-files",
    labelKey: "menu.pdfFiles",
    description: "Upload and manage your PDF documents.",
    icon: "file-text",
    role: "",
  },
  {
    path: "users",
    labelKey: "menu.users",
    description: "Manage accounts, roles and status.",
    icon: "users",
    role: "ROLE_ADMIN",
  },
];

/**
 * Admin-only items are hidden from everyone else; the remaining items are
 * visible to any authenticated role (the backend's asset endpoints are
 * owner-scoped, not role-gated).
 */
export function visibleMenuItems(role: Role | null): Menu[] {
  return MENU_ITEMS.filter(
    (item) => item.role !== "ROLE_ADMIN" || role === "ROLE_ADMIN",
  );
}
