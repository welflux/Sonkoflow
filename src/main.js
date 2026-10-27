const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navigation');
function closeMenu() { menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); }
menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); });
nav.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
window.matchMedia('(min-width: 1001px)').addEventListener('change', event => { if (event.matches) closeMenu(); });
const slider = document.querySelector('#comparison-range');
slider.addEventListener('input', () => document.querySelector('.comparison').style.setProperty('--split', `${slider.value}%`));
document.querySelector('#year').textContent = new Date().getFullYear();
