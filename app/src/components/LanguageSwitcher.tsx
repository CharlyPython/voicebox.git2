import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation("common");

  const changeLanguage = (lng: "en" | "vi") => {
    i18n.changeLanguage(lng);
    try {
      localStorage.setItem("i18nextLng", lng);
    } catch {}
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="language-switcher" className="text-sm text-muted-foreground">
        {t("common.language")}
      </label>
      <select
        id="language-switcher"
        value={i18n.language?.startsWith("vi") ? "vi" : "en"}
        onChange={(e) => changeLanguage(e.target.value as "en" | "vi")}
        className="rounded border border-border bg-background px-2 py-1 text-sm"
      >
        <option value="en">English</option>
        <option value="vi">Tiếng Việt</option>
      </select>
    </div>
  );
}
