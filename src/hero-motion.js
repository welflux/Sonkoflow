export function startHeroScrollMotion() {
  const art = document.querySelector('.hero-art');
  if (!art) return;
  const tiles = [...art.querySelectorAll('.hero-tile')];
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  const played = new Set();
  const distance = innerWidth <= 600 ? 48 : 110;
  const starts = [`-${distance}px 0px`, '0px -90px', `${distance}px 0px`];
  let observer;

  function settle(tile) {
    tile.style.removeProperty('translate');
    tile.style.removeProperty('opacity');
    animations.get(tile)?.cancel();
    animations.delete(tile);
  }
  function reveal(tile) {
    if (played.has(tile)) return;
    played.add(tile);
    observer?.unobserve(tile);
    const index = tiles.indexOf(tile);
    const animation = tile.animate([
      {translate: starts[index], opacity: index === 1 ? 0 : 1},
      {translate: '0px 0px', opacity: 1},
    ], {duration: 1400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both'});
    animations.set(tile, animation);
    animation.onfinish = () => settle(tile);
  }
  if (preference.matches || !('IntersectionObserver' in window)) return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) reveal(entry.target);
    });
  }, {threshold: 0.15});
  tiles.forEach((tile, index) => {
    tile.style.translate = starts[index];
    if (index === 1) tile.style.opacity = '0';
    observer.observe(tile);
  });
  preference.addEventListener('change', () => {
    if (!preference.matches) return;
    observer.disconnect();
    tiles.forEach(tile => { played.add(tile); settle(tile); });
  });
}
