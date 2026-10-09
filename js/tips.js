// little hover tips for anything with a data-tip attribute

const tip = document.createElement('div');
tip.className = 'tip';
tip.setAttribute('role', 'tooltip');
tip.hidden = true;
document.body.append(tip);

let timer = 0, current = null, keyboard = false;
let px = 0, py = 0;
document.addEventListener('pointermove', (e) => {
  px = e.clientX;
  py = e.clientY;
}, { passive: true });

function place(el) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  // big things (the timeline) get the tip next to the mouse instead of under the whole box
  const big = r.height > 60 && !keyboard;
  let x = (big ? px : r.left + r.width / 2) - t.width / 2;
  let y = big ? py + 18 : r.bottom + 6;
  if (y + t.height > innerHeight - 4) y = (big ? py : r.top) - t.height - 6;
  x = Math.max(6, Math.min(innerWidth - t.width - 6, x));
  tip.style.left = x + 'px';
  tip.style.top = Math.max(6, y) + 'px';
}

function hide() {
  clearTimeout(timer);
  tip.hidden = true;
  current = null;
}

document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el === current) return;
  hide();
  if (!el || e.pointerType === 'touch') return;
  current = el;
  timer = setTimeout(() => place(el), 450);
});

document.addEventListener('pointerout', (e) => {
  if (current && !current.contains(e.relatedTarget)) hide();
});

// only pop up on focus when tabbing around, not when clicking into a field
document.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el && keyboard) {
    current = el;
    place(el);
  }
});

document.addEventListener('focusout', hide);
document.addEventListener('pointerdown', () => {
  keyboard = false;
  hide();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') keyboard = true;
  if (e.key === 'Escape') hide();
});
addEventListener('scroll', hide, true);
