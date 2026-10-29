import { startHeroScrollMotion } from "./hero-motion.js";
import { startHeroTypewriter } from "./typewriter.js";
import "./public.js";
const slider = document.querySelector("#comparison-range");
slider?.addEventListener("input", () =>
  document
    .querySelector(".comparison")
    .style.setProperty("--split", `${slider.value}%`),
);
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    let n = tabs.indexOf(tab);
    if (e.key === "ArrowRight") n = (n + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (n + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    selectTab(tabs[n], true);
  });
}

startHeroTypewriter();

startHeroScrollMotion();
