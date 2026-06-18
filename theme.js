// ─── Theme (dark / light) ───────────────────────────────────────────────
// Applies the saved theme before paint where possible, and wires up any
// .theme-toggle button found on the page.
(function () {
  const KEY = "relayTheme";

  function getTheme() {
    try { return localStorage.getItem(KEY) || "dark"; } catch { return "dark"; }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* storage blocked */ }
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      btn.textContent = theme === "light" ? "🌙" : "☀️";
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
    });
    document.dispatchEvent(new CustomEvent("relay-theme-change", { detail: { theme } }));
  }

  // Apply immediately (before DOMContentLoaded) to avoid a flash of the wrong theme.
  document.documentElement.setAttribute("data-theme", getTheme());

  function wireToggle() {
    setTheme(getTheme());
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      btn.addEventListener("click", () => setTheme(getTheme() === "dark" ? "light" : "dark"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireToggle);
  } else {
    wireToggle();
  }

  window.RelayTheme = { getTheme, setTheme };
})();
