// Reserve the complete phrase so typing never shifts the headline or artwork.
export function startHeroTypewriter() {
  const word = document.querySelector('.landing-hero h1 em');
  if (!word) return;
  const phrase = word.textContent;
  const characters = Array.from(phrase);
  const reserve = document.createElement('span');
  reserve.className = 'typewriter-reserve';
  reserve.textContent = phrase;
  reserve.setAttribute('aria-hidden', 'true');
  const ink = document.createElement('span');
  ink.className = 'typewriter-ink';
  ink.setAttribute('aria-hidden', 'true');
  word.classList.add('hero-typewriter');
  word.replaceChildren(reserve, ink);
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let timer;
  function render(count) { ink.textContent = characters.slice(0, count).join(''); }
  function schedule(action, delay) { timer = setTimeout(action, delay); }
  function restart() {
    clearTimeout(timer);
    word.classList.remove('is-writing');
    render(characters.length);
    if (preference.matches || document.hidden) return;
    let count = 0;
    let deleting = false;
    word.classList.add('is-writing');
    function step() {
      count += deleting ? -1 : 1;
      render(count);
      if (count === characters.length) {
        deleting = true;
        schedule(step, 2200);
      } else if (count === 0) {
        deleting = false;
        schedule(step, 650);
      } else schedule(step, deleting ? 65 : 130);
    }
    render(0);
    schedule(step, 350);
  }
  preference.addEventListener('change', restart);
  document.addEventListener('visibilitychange', restart);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('pageshow', restart);
  restart();
}
