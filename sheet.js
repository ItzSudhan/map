/* Map: draggable bottom sheet on phones (peek / half / full), like Google Maps' mobile app. */
(() => {
  const panel = $('#panel');
  const handle = document.createElement('div');
  handle.className = 'sheet-handle';
  handle.innerHTML = '<span></span>';
  panel.prepend(handle);

  const SNAPS = { peek: 0.3, half: 0.55, full: 0.92 }; // fraction of the viewport height
  const isPhone = () => innerWidth <= 640;
  let snap = 'half', startY = 0, startH = 0, dragging = false, lastY = 0, lastT = 0, velocity = 0;

  function setHeight(px, animate) {
    panel.style.transition = animate ? 'height .3s cubic-bezier(.2,.8,.2,1)' : 'none';
    panel.style.height = `${px}px`;
  }
  function snapTo(name, animate = true) {
    snap = name;
    setHeight(innerHeight * SNAPS[name], animate);
    panel.classList.toggle('sheet-full', name === 'full');
  }
  function start(y) {
    if (!isPhone()) return;
    dragging = true; startY = lastY = y; lastT = performance.now(); startH = panel.getBoundingClientRect().height; velocity = 0;
  }
  function move(y) {
    if (!dragging) return;
    const now = performance.now();
    velocity = (y - lastY) / Math.max(1, now - lastT); lastY = y; lastT = now;
    setHeight(Math.max(innerHeight * 0.15, Math.min(innerHeight * 0.95, startH + (startY - y))), false);
  }
  function end() {
    if (!dragging) return;
    dragging = false;
    const frac = panel.getBoundingClientRect().height / innerHeight;
    // A quick flick moves one step in that direction; otherwise snap to the nearest height.
    const order = ['peek', 'half', 'full'];
    let target = Object.keys(SNAPS).reduce((a, b) => (Math.abs(SNAPS[b] - frac) < Math.abs(SNAPS[a] - frac) ? b : a));
    if (Math.abs(velocity) > 0.5) target = order[Math.max(0, Math.min(2, order.indexOf(snap) + (velocity < 0 ? 1 : -1)))];
    if (frac < 0.2 && velocity > 0) { closePanel(); return; }
    snapTo(target);
  }

  handle.addEventListener('touchstart', (e) => start(e.touches[0].clientY), { passive: true });
  // Dragging the panel content also works when it's scrolled to the top.
  panel.addEventListener('touchstart', (e) => { if (panel.scrollTop <= 0 && !e.target.closest('input, .strip, .wx, button')) start(e.touches[0].clientY); }, { passive: true });
  addEventListener('touchmove', (e) => { if (dragging && (e.target === handle || panel.scrollTop <= 0)) move(e.touches[0].clientY); }, { passive: true });
  addEventListener('touchend', end);
  handle.addEventListener('click', () => isPhone() && snapTo(snap === 'full' ? 'half' : 'full'));

  // Reset to "half" whenever the panel opens on a phone.
  new MutationObserver(() => {
    if (!isPhone()) { panel.style.height = ''; return; }
    if (!panel.classList.contains('hidden') && !dragging) snapTo(document.body.classList.contains('directions-mode') ? 'full' : 'half', false);
  }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => { if (!isPhone()) panel.style.height = ''; else if (!panel.classList.contains('hidden')) snapTo(snap, false); });
})();
