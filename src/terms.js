// Optional reading controls; the complete agreement is server-delivered HTML.
const index = document.querySelector(".terms-index");
const narrow = matchMedia("(max-width: 760px)");
function sizeIndex() {
  if (index) index.open = !narrow.matches;
}
sizeIndex();
narrow.addEventListener("change", sizeIndex);
const print = document.querySelector(".terms-print");
if (print) {
  print.hidden = false;
  print.addEventListener("click", () => window.print());
}
const links = [...document.querySelectorAll(".terms-index a")];
const sections = [...document.querySelectorAll(".terms-section")];
let scheduled = false;
function updateReadingPosition() {
  scheduled = false;
  // Choose the latest section heading above the reading line, including after
  // smooth anchor navigation settles inside a long preceding section.
  const current = sections
    .filter((section) => section.getBoundingClientRect().top <= 170)
    .at(-1);
  for (const link of links) {
    if (current && link.hash === "#" + current.id)
      link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
function schedulePositionUpdate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(updateReadingPosition);
}
window.addEventListener("scroll", schedulePositionUpdate, { passive: true });
window.addEventListener("resize", schedulePositionUpdate);
updateReadingPosition();
