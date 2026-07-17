/* ============================================================
   SOUL ECONOMY — main.js
   Cursor · Matrix Kanji Rain · Sakura Petals · Scroll Reveal · 3D Card Tilt · Bento Glow
   ============================================================ */

/* ── CUSTOM CURSOR ── */
const cur = document.getElementById('cursor');
const curRing = document.getElementById('cursor-ring');
let cx = 0, cy = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  cx = e.clientX; cy = e.clientY;
  cur.style.left = cx + 'px';
  cur.style.top  = cy + 'px';
});

(function lerpRing() {
  rx += (cx - rx) * 0.11;
  ry += (cy - ry) * 0.11;
  curRing.style.left = rx + 'px';
  curRing.style.top  = ry + 'px';
  requestAnimationFrame(lerpRing);
})();

document.querySelectorAll('a, button, .bento-card, .char-card, .marquee-card').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cur.style.transform      = 'translate(-50%,-50%) scale(2.8)';
    cur.style.background     = 'var(--gold)';
    curRing.style.transform  = 'translate(-50%,-50%) scale(1.6)';
    curRing.style.borderColor = 'rgba(245,200,66,.5)';
  });
  el.addEventListener('mouseleave', () => {
    cur.style.transform      = 'translate(-50%,-50%) scale(1)';
    cur.style.background     = 'var(--pink)';
    curRing.style.transform  = 'translate(-50%,-50%) scale(1)';
    curRing.style.borderColor = 'rgba(255,96,144,.5)';
  });
});

/* ── MATRIX KANJI RAIN ── */
(function () {
  const cv = document.getElementById('matrix-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const CHARS = '魂霊道龍力神炎命運剣術心夢影血戦0123456789SOUL';
  let cols, drops;

  function init() {
    cv.width  = window.innerWidth;
    cv.height = window.innerHeight;
    cols  = Math.floor(cv.width / 22);
    drops = Array(cols).fill(1).map(() => Math.random() * -50);
  }
  init();
  window.addEventListener('resize', init);

  setInterval(() => {
    ctx.fillStyle = 'rgba(3,0,13,.07)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = '15px "Noto Serif JP", monospace';

    drops.forEach((y, i) => {
      const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
      const a  = Math.random();
      if      (a > .75) ctx.fillStyle = `rgba(255,96,144,${(a * .65).toFixed(2)})`;
      else if (a > .45) ctx.fillStyle = `rgba(230,0,40,${(a * .5).toFixed(2)})`;
      else              ctx.fillStyle = `rgba(140,20,50,${(a * .4).toFixed(2)})`;

      ctx.fillText(ch, i * 22, y * 22);
      if (y * 22 > cv.height && Math.random() > .975) drops[i] = 0;
      drops[i] += 1;
    });
  }, 55);
})();

/* ── SAKURA PETALS ── */
(function () {
  const cv = document.getElementById('sakura-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');

  function resize() { cv.width = innerWidth; cv.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function mkPetal() {
    return {
      x: rnd(0, innerWidth), y: rnd(-80, -10),
      size: rnd(4, 11),
      vy: rnd(.4, 1.5), vx: rnd(-.4, .4),
      rot: rnd(0, Math.PI * 2), rotS: rnd(-.025, .025),
      op: rnd(.18, .58),
      sw: rnd(.2, .7), swO: rnd(0, Math.PI * 2)
    };
  }

  const petals = [];
  for (let i = 0; i < 30; i++) {
    const p = mkPetal();
    p.y = rnd(0, innerHeight);
    petals.push(p);
  }

  let frame = 0;
  (function loop() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    frame++;
    petals.forEach(p => {
      p.y += p.vy;
      p.x += p.vx + Math.sin(frame * .01 + p.swO) * p.sw;
      p.rot += p.rotS;
      if (p.y > cv.height + 20 || p.x < -40 || p.x > cv.width + 40) {
        Object.assign(p, mkPetal());
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.op;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.bezierCurveTo(p.size * .8, -p.size * .5, p.size * .8,  p.size * .5, 0, p.size * .3);
      ctx.bezierCurveTo(-p.size * .8, p.size * .5, -p.size * .8, -p.size * .5, 0, -p.size);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      g.addColorStop(0, 'rgba(255,170,200,.95)');
      g.addColorStop(.55, 'rgba(220,80,120,.65)');
      g.addColorStop(1, 'rgba(180,40,80,.08)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    });
    requestAnimationFrame(loop);
  })();
})();

/* ── NAV SCROLL ── */
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  });
}

/* ── NAV MOBILE TOGGLE ── */
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
}

/* ── SCROLL REVEAL ── */
const revealEls = document.querySelectorAll('.reveal');
if (revealEls.length) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: .1 });
  revealEls.forEach(el => io.observe(el));
}

/* ── BENTO + CARD MOUSE GLOW ── */
document.querySelectorAll('.bento-card, .marquee-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', ((e.clientX - r.left) / r.width  * 100).toFixed(1) + '%');
    card.style.setProperty('--my', ((e.clientY - r.top)  / r.height * 100).toFixed(1) + '%');
  });
});

/* ── HERO CARD 3D TILT ── */
const mainCard = document.getElementById('mainCard');
if (mainCard) {
  mainCard.addEventListener('mousemove', e => {
    const r = mainCard.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width  - .5) * 24;
    const y = -((e.clientY - r.top)  / r.height - .5) * 24;
    mainCard.style.transform = `rotateY(${x}deg) rotateX(${y}deg) scale(1.06)`;
    mainCard.style.boxShadow = `${-x*.5}px ${y*.5}px 80px rgba(230,0,40,.4), 0 60px 100px rgba(0,0,0,.8)`;
  });
  mainCard.addEventListener('mouseleave', () => {
    mainCard.style.transform = '';
    mainCard.style.boxShadow = '';
  });
}
