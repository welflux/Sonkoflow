document.documentElement.classList.add("js-enabled");
const menu = document.querySelector(".menu-toggle"),
  nav = document.querySelector("#navigation");
function closeMenu() {
  if (!menu || !nav) return;
  menu.setAttribute("aria-expanded", "false");
  nav.classList.remove("open");
}
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  nav.classList.toggle("open", open);
});
nav?.addEventListener("click", (e) => {
  if (e.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    for (const d of document.querySelectorAll(".nav-resources[open]")) {
      d.open = false;
      d.querySelector("summary").focus();
    }
    if (menu?.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menu.focus();
    }
  }
});
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll(".nav-resources[open]"))
    if (!d.contains(e.target)) d.open = false;
});
window.matchMedia("(min-width:961px)").addEventListener("change", (e) => {
  if (e.matches) closeMenu();
});
