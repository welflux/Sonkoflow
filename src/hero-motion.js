export function startHeroScrollMotion() {
  const art = document.querySelector('.hero-art');
  if (!art) return;
  const tiles = [...art.querySelectorAll('.hero-tile')];
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const amounts = [-52, 30, -38];
  let frame = 0;
  let visible = true;
  function update() {
    frame = 0;
    const rect = art.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, scrollY / Math.max(1, rect.top + scrollY + rect.height)));
    const scale = innerWidth <= 600 ? 0.4 : innerWidth <= 1100 ? 0.7 : 1;
    tiles.forEach((tile, index) => tile.style.setProperty('--hero-scroll-y', `${preference.matches ? 0 : progress * amounts[index] * scale}px`));
  }
  function schedule() {
    if (!frame && visible && !preference.matches) frame = requestAnimationFrame(update);
  }
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    update();
  }
  addEventListener('scroll', schedule, {passive:true});
  addEventListener('resize', reset);
  addEventListener('pageshow', reset);
  addEventListener('pagehide', () => cancelAnimationFrame(frame));
  preference.addEventListener('change', reset);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) schedule();
    }, {rootMargin:'200px'}).observe(art);
  }
  reset();
}
