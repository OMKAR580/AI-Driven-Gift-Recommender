import './theme.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const ALLOWED_IMAGES = new Set([
  '/ai_gift_box.png',
  '/candle_mock.png',
  '/desk_mat_mock.png',
  '/elegant_perfume.png',
  '/headphones_mock.png',
  '/luxury_watch.png',
  '/matte_watch.png',
  '/minimal_desk.png',
  '/modern_coffee_mug.png',
  '/sleek_wallet.png',
  '/smart_ring_mock.png',
  '/zen_garden.png',
]);

const PLATFORM_NAMES = ['Amazon', 'Flipkart', 'Myntra', 'Meesho'];
const RESULT_LABELS = ['Editor pick', 'Statement gift', 'Daily upgrade', 'Conversation starter', 'Quiet luxury', 'Smart utility'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const FALLBACK_ITEMS = [
  {
    title: 'Premium Smart Ring',
    desc: 'A low-profile titanium ring that tracks sleep, recovery, and activity without looking like a gadget.',
    img: '/smart_ring_mock.png',
    p: [19999, 18500, 21000, 19500],
  },
  {
    title: 'Temperature Control Mug',
    desc: 'A refined desk companion that keeps coffee at the exact right temperature through long work sessions.',
    img: '/modern_coffee_mug.png',
    p: [8900, 8500, 9200, 8400],
  },
  {
    title: 'Luxury Noise-Canceling Headphones',
    desc: 'Deep comfort, clean industrial design, and immersive audio for commutes, flights, or focused work.',
    img: '/headphones_mock.png',
    p: [24900, 24500, 25100, 23900],
  },
  {
    title: 'Artisan Zen Garden',
    desc: 'A minimal desktop ritual piece that brings a calmer, more intentional mood to a workspace.',
    img: '/zen_garden.png',
    p: [2500, 2400, 2700, 2650],
  },
  {
    title: 'Sleek Leather Wallet',
    desc: 'A compact everyday essential with a grown-up silhouette and enough polish to feel gift-worthy.',
    img: '/sleek_wallet.png',
    p: [3999, 3799, 4200, 3890],
  },
  {
    title: 'Desk Setup Refresh Kit',
    desc: 'A composed bundle that upgrades their workspace with texture, utility, and a cleaner visual rhythm.',
    img: '/desk_mat_mock.png',
    p: [6999, 6720, 7290, 6840],
  },
];

const CURATED_COLLECTIONS = {
  'desk-rituals': {
    title: 'Minimal Desk Setup Kit',
    desc: 'A refined workspace gift built around clean accessories, soft textures, and useful upgrades that make every desk session feel better.',
    img: '/minimal_desk.png',
    p: [6999, 6720, 7290, 6840],
    searchTerm: 'minimal desk setup accessories gift set',
  },
  'evening-energy': {
    title: 'Signature Evening Fragrance',
    desc: 'A polished fragrance pick with warm depth, elegant projection, and the kind of presence that feels like a confident gift.',
    img: '/elegant_perfume.png',
    p: [8499, 8120, 8890, 7990],
    searchTerm: 'signature evening perfume gift set',
  },
  'quiet-luxury': {
    title: 'Artisan Zen Garden',
    desc: 'A calming desktop ritual piece that brings texture, stillness, and a quietly premium mood to a home or workspace.',
    img: '/zen_garden.png',
    p: [2500, 2400, 2700, 2650],
    searchTerm: 'artisan zen garden premium desktop decor',
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const bindCursorTargets = setupCursor();
  const bindTilts = setupTiltInteractions();

  setupSmoothScroll();
  splitHeroHeading();
  runIntroAnimations();
  setupEditorialStrip();
  setupHeroStage();
  setupContactStage();
  setupScrollAnimations();
  setupTagInteractions();
  setupPromptChips(bindCursorTargets);
  setupGenerator(bindCursorTargets, bindTilts);
  setupContactForm();
  setupModal();

  bindCursorTargets(document.querySelectorAll('a, button, .tag, .elegant-input, textarea, .prompt-chip, .contact-method'));
  bindTilts(document.querySelectorAll('.floating-card, .point-card, .collection-card, .feature-card, .timeline-step, .studio-card, .footer-cta-card, .contact-form, .contact-stack-card, .contact-method'));

  window.addEventListener('load', () => ScrollTrigger.refresh());
});

function setupCursor() {
  const cursor = document.querySelector('.cursor');
  const cursorFollower = document.querySelector('.cursor-follower');
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (!finePointer || !cursor || !cursorFollower) {
    return () => {};
  }

  const rootStyles = getComputedStyle(document.documentElement);
  const accentStrong = rootStyles.getPropertyValue('--accent-strong').trim() || '#ff9a61';
  const accentSecondary = rootStyles.getPropertyValue('--accent-secondary').trim() || '#70d6c1';

  const setCursorState = (isActive) => {
    gsap.to(cursorFollower, {
      scale: isActive ? 1.45 : 1,
      borderColor: isActive ? accentSecondary : 'rgba(247, 241, 232, 0.4)',
      duration: 0.25,
      overwrite: true,
    });

    gsap.to(cursor, {
      scale: isActive ? 0.6 : 1,
      backgroundColor: isActive ? accentSecondary : accentStrong,
      duration: 0.25,
      overwrite: true,
    });
  };

  document.addEventListener('mousemove', (event) => {
    gsap.to(cursor, { x: event.clientX, y: event.clientY, duration: 0, overwrite: true });
    gsap.to(cursorFollower, { x: event.clientX, y: event.clientY, duration: 0.12, overwrite: true });
  });

  return (targets) => {
    targets.forEach((target) => {
      if (!(target instanceof HTMLElement) || target.dataset.cursorBound === 'true') {
        return;
      }

      target.dataset.cursorBound = 'true';
      target.addEventListener('mouseenter', () => setCursorState(true));
      target.addEventListener('mouseleave', () => setCursorState(false));
      target.addEventListener('focus', () => setCursorState(true));
      target.addEventListener('blur', () => setCursorState(false));
    });
  };
}

function setupTiltInteractions() {
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (!finePointer || reducedMotion) {
    return () => {};
  }

  return (targets) => {
    targets.forEach((target) => {
      if (!(target instanceof HTMLElement) || target.dataset.tiltBound === 'true') {
        return;
      }

      target.dataset.tiltBound = 'true';
      const media = target.querySelector('img, .card-img');
      target.style.setProperty('--glow-x', '50%');
      target.style.setProperty('--glow-y', '50%');

      target.addEventListener('pointermove', (event) => {
        const rect = target.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        const glowX = `${((event.clientX - rect.left) / rect.width) * 100}%`;
        const glowY = `${((event.clientY - rect.top) / rect.height) * 100}%`;

        target.style.setProperty('--glow-x', glowX);
        target.style.setProperty('--glow-y', glowY);
        target.classList.add('is-glow-active');

        gsap.to(target, {
          rotationY: x * 10,
          rotationX: -y * 10,
          transformPerspective: 1200,
          transformOrigin: 'center center',
          duration: 0.35,
          ease: 'power2.out',
          overwrite: true,
        });

        if (media) {
          gsap.to(media, {
            x: x * 12,
            y: y * 10,
            scale: 1.04,
            duration: 0.35,
            ease: 'power2.out',
            overwrite: true,
          });
        }
      });

      target.addEventListener('pointerleave', () => {
        target.style.setProperty('--glow-x', '50%');
        target.style.setProperty('--glow-y', '50%');
        target.classList.remove('is-glow-active');

        gsap.to(target, {
          rotationY: 0,
          rotationX: 0,
          duration: 0.55,
          ease: 'power3.out',
          overwrite: true,
        });

        if (media) {
          gsap.to(media, {
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.55,
            ease: 'power3.out',
            overwrite: true,
          });
        }
      });
    });
  };
}

function splitHeroHeading() {
  const heading = document.getElementById('heroHeading');

  if (!heading) {
    return;
  }

  const text = heading.textContent.trim();
  heading.innerHTML = '';

  text.split(' ').forEach((word) => {
    const span = document.createElement('span');
    span.className = 'anim-word';
    span.textContent = `${word} `;
    heading.appendChild(span);
  });
}

function runIntroAnimations() {
  const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });

  timeline
    .to('.loader-text .word', {
      y: 0,
      opacity: 1,
      duration: reducedMotion ? 0.2 : 0.8,
      stagger: reducedMotion ? 0.02 : 0.18,
    })
    .fromTo(
      '.loader-progress',
      { scaleX: 0, transformOrigin: 'left center' },
      {
        scaleX: 1,
        duration: reducedMotion ? 0.2 : 1,
        ease: 'power2.inOut',
      },
      '-=0.35',
    )
    .to('.loader', {
      yPercent: -100,
      autoAlpha: 0,
      duration: reducedMotion ? 0.25 : 1.05,
      ease: 'power4.inOut',
      delay: reducedMotion ? 0 : 0.18,
    })
    .set('.loader', { display: 'none' })
    .from(
      '.navbar',
      {
        y: -36,
        opacity: 0,
        duration: reducedMotion ? 0.2 : 0.7,
      },
      '-=0.35',
    )
    .from(
      ['.eyebrow', '.hero-chip'],
      {
        y: 18,
        opacity: 0,
        duration: reducedMotion ? 0.18 : 0.55,
        stagger: 0.08,
      },
      '-=0.15',
    )
    .from(
      '.anim-word',
      {
        y: 56,
        opacity: 0,
        duration: reducedMotion ? 0.18 : 0.78,
        stagger: reducedMotion ? 0.02 : 0.1,
        ease: reducedMotion ? 'power1.out' : 'back.out(1.7)',
      },
      '-=0.05',
    )
    .from(
      '.hero-title--accent',
      {
        y: 26,
        opacity: 0,
        duration: reducedMotion ? 0.18 : 0.55,
      },
      '-=0.55',
    )
    .from(
      '.hero-stage',
      {
        scale: 0.96,
        opacity: 0,
        rotateX: 4,
        duration: reducedMotion ? 0.2 : 1.1,
      },
      '-=0.7',
    )
    .fromTo(
      ['#heroAutoFade', '.hero-cta-group'],
      { y: 28, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: reducedMotion ? 0.18 : 0.7,
        stagger: 0.14,
      },
      '-=0.45',
    )
    .from(
      ['.stage-badge', '.floating-card', '.scene'],
      {
        y: 22,
        opacity: 0,
        duration: reducedMotion ? 0.16 : 0.55,
        stagger: 0.08,
      },
      '-=0.8',
    )
    .call(startTypewriter);
}

function startTypewriter() {
  const phrases = ['beautifully', 'with presence', 'for milestone moments', 'without the guesswork'];
  const target = document.getElementById('typewriterText');

  if (!target) {
    return;
  }

  let isDeleting = false;
  let loopIndex = 0;
  let currentText = '';

  function tick() {
    const phrase = phrases[loopIndex % phrases.length];

    currentText = isDeleting
      ? phrase.slice(0, currentText.length - 1)
      : phrase.slice(0, currentText.length + 1);

    target.textContent = currentText;

    let delay = isDeleting ? 45 : 80;

    if (!isDeleting && currentText === phrase) {
      delay = 1800;
      isDeleting = true;
    } else if (isDeleting && currentText === '') {
      isDeleting = false;
      loopIndex += 1;
      delay = 320;
    }

    window.setTimeout(tick, reducedMotion ? 120 : delay);
  }

  tick();
}

function setupEditorialStrip() {
  const track = document.querySelector('.editorial-strip__track');

  if (!track || reducedMotion) {
    return;
  }

  gsap.to(track, {
    xPercent: -50,
    duration: 24,
    ease: 'none',
    repeat: -1,
  });
}

function setupSmoothScroll() {
  const navbar = document.querySelector('.navbar');
  const links = document.querySelectorAll('a[href^="#"]:not([href="#"])');

  if (!links.length) {
    return;
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const href = link.getAttribute('href');

      if (!href) {
        return;
      }

      const target = document.querySelector(href);

      if (!target) {
        return;
      }

      event.preventDefault();

      const navOffset = navbar ? navbar.getBoundingClientRect().height + 24 : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - navOffset;

      window.scrollTo({
        top: Math.max(0, top),
        behavior: reducedMotion ? 'auto' : 'smooth',
      });

      if (window.location.hash !== href) {
        window.history.replaceState(null, '', href);
      }
    });
  });
}

function setupHeroStage() {
  const stage = document.querySelector('.hero-stage');
  const stageMotion = document.querySelector('.hero-stage__motion');
  const spotlight = document.querySelector('.spotlight');

  if (!stage || !stageMotion) {
    setupCube();
    return;
  }

  if (!reducedMotion) {
    gsap.to('.stage-rays', {
      rotate: 360,
      duration: 36,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.orbit--outer', {
      rotate: 360,
      duration: 24,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.orbit--inner', {
      rotate: -360,
      duration: 18,
      ease: 'none',
      repeat: -1,
    });

    ['.float-1', '.float-2', '.float-3', '.float-4'].forEach((selector, index) => {
      gsap.to(selector, {
        yPercent: index % 2 === 0 ? -7 : 6,
        xPercent: index < 2 ? 2 : -2,
        duration: 3.8 + index * 0.25,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });

    gsap.utils.toArray('.insight-panel__bars span').forEach((bar, index) => {
      gsap.to(bar, {
        scaleY: 0.45 + ((index % 3) + 1) * 0.18,
        transformOrigin: 'bottom center',
        duration: 0.9 + index * 0.12,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });
  }

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const interactiveStage = finePointer && !reducedMotion && window.matchMedia('(min-width: 1025px)').matches;

  if (interactiveStage) {
    gsap.set(stageMotion, {
      transformPerspective: 1600,
      transformStyle: 'preserve-3d',
      force3D: true,
    });

    let stageRect = stage.getBoundingClientRect();
    const updateRect = () => {
      stageRect = stage.getBoundingClientRect();
    };
    const rotateYTo = gsap.quickTo(stageMotion, 'rotationY', { duration: 0.42, ease: 'power2.out' });
    const rotateXTo = gsap.quickTo(stageMotion, 'rotationX', { duration: 0.42, ease: 'power2.out' });
    const spotlightXTo = spotlight ? gsap.quickTo(spotlight, 'x', { duration: 0.5, ease: 'power2.out' }) : null;
    const spotlightYTo = spotlight ? gsap.quickTo(spotlight, 'y', { duration: 0.5, ease: 'power2.out' }) : null;

    stage.addEventListener('pointerenter', updateRect, { passive: true });
    window.addEventListener('resize', updateRect, { passive: true });

    stage.addEventListener('pointermove', (event) => {
      const x = (event.clientX - stageRect.left) / stageRect.width - 0.5;
      const y = (event.clientY - stageRect.top) / stageRect.height - 0.5;

      rotateYTo(x * 6.5);
      rotateXTo(-y * 5.5);
      spotlightXTo?.(x * 24);
      spotlightYTo?.(y * 20);
    }, { passive: true });

    stage.addEventListener('pointerleave', () => {
      rotateYTo(0);
      rotateXTo(0);
      spotlightXTo?.(0);
      spotlightYTo?.(0);
    });
  }

  setupCube(stage);
}

function setupPromptChips(bindCursorTargets) {
  const chips = document.querySelectorAll('.prompt-chip');
  const input = document.getElementById('recipientName');

  if (!chips.length || !input) {
    return;
  }

  bindCursorTargets(chips);

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt') || '';
      input.value = prompt;
      input.focus();

      chips.forEach((item) => item.classList.remove('is-active'));
      chip.classList.add('is-active');

      gsap.fromTo(
        input,
        { boxShadow: '0 0 0 0 rgba(255, 154, 97, 0.0)' },
        {
          boxShadow: '0 0 0 10px rgba(255, 154, 97, 0.14)',
          duration: 0.4,
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut',
        },
      );
    });
  });
}

function setupContactStage() {
  const stage = document.querySelector('.contact-stage');
  const stageGrid = stage?.querySelector('.contact-stage__grid');
  const flow = stage?.querySelector('.contact-flow');
  const hub = stage?.querySelector('.contact-flow__hub');
  const ambientWarm = stage?.querySelector('.contact-ambient--warm');
  const ambientCool = stage?.querySelector('.contact-ambient--cool');

  if (!stage || reducedMotion) {
    return;
  }

  gsap.utils.toArray('.contact-stack-card').forEach((card, index) => {
    gsap.to(card, {
      yPercent: index === 1 ? -3 : 4,
      xPercent: index === 0 ? -1.2 : index === 1 ? 1.2 : 0.8,
      rotateZ: index === 0 ? -1.2 : index === 1 ? 1.1 : -0.8,
      duration: 4.5 + index * 0.45,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
  });

  gsap.to(ambientWarm, {
    y: -18,
    x: 20,
    duration: 5.4,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  });

  gsap.to(ambientCool, {
    y: 16,
    x: -18,
    duration: 6,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  });

  if (flow && hub) {
    if (stageGrid) {
      gsap.to(stageGrid, {
        x: -14,
        y: -10,
        duration: 18,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    }

    gsap.to('.contact-flow__trace--one', {
      strokeDashoffset: -160,
      duration: 7.5,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__trace--two', {
      strokeDashoffset: -130,
      duration: 6.8,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__trace--three', {
      strokeDashoffset: -148,
      duration: 8.2,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__hub-ring--outer', {
      rotate: 360,
      svgOrigin: '342 248',
      duration: 20,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__hub-ring--inner', {
      rotate: -360,
      svgOrigin: '342 248',
      duration: 14,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__hub', {
      y: -6,
      rotate: 8,
      svgOrigin: '342 248',
      duration: 6.8,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__halo--outer', {
      scale: 1.06,
      opacity: 0.52,
      svgOrigin: '342 248',
      duration: 4.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });

    gsap.to('.contact-flow__halo--inner', {
      scale: 1.1,
      opacity: 0.38,
      svgOrigin: '342 248',
      duration: 5.6,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__hub-prism', {
      rotate: -8,
      y: -4,
      svgOrigin: '342 248',
      duration: 5.2,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__hub-facet', {
      rotate: 10,
      y: 2,
      svgOrigin: '342 248',
      duration: 4.6,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__hub-core', {
      scale: 1.2,
      opacity: 0.92,
      svgOrigin: '342 248',
      duration: 2.4,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.utils.toArray('.contact-flow__spark').forEach((spark, index) => {
      gsap.to(spark, {
        opacity: 0.2 + index * 0.08,
        duration: 1.9 + index * 0.4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    });

    gsap.utils.toArray('.contact-flow__node').forEach((node, index) => {
      gsap.to(node, {
        scale: index === 1 ? 1.28 : 1.18,
        duration: 2.3 + index * 0.35,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });

    const animatePulseAlongPath = (pulseSelector, pathSelector, duration, delay = 0) => {
      const pulse = stage.querySelector(pulseSelector);
      const path = stage.querySelector(pathSelector);

      if (!pulse || !path) {
        return;
      }

      const length = path.getTotalLength();
      const state = { progress: 0 };

      const render = () => {
        const point = path.getPointAtLength(length * state.progress);
        let opacity = 1;

        if (state.progress < 0.12) {
          opacity = state.progress / 0.12;
        } else if (state.progress > 0.82) {
          opacity = Math.max(0, 1 - (state.progress - 0.82) / 0.18);
        }

        gsap.set(pulse, {
          attr: { cx: point.x, cy: point.y },
          opacity,
        });
      };

      render();

      gsap.to(state, {
        progress: 1,
        duration,
        delay,
        ease: 'none',
        repeat: -1,
        onUpdate: render,
      });
    };

    animatePulseAlongPath('.contact-flow__pulse--one', '.contact-flow__path--one', 5.6, 0.2);
    animatePulseAlongPath('.contact-flow__pulse--two', '.contact-flow__path--two', 4.8, 0.8);
    animatePulseAlongPath('.contact-flow__pulse--three', '.contact-flow__path--three', 5.2, 0.4);
  }

  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (!finePointer) {
    return;
  }

  stage.addEventListener('pointermove', (event) => {
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    gsap.to(flow, {
      x: x * 18,
      y: y * 14,
      duration: 0.7,
      ease: 'power3.out',
      overwrite: true,
    });

    gsap.to(ambientWarm, {
      x: x * 28,
      y: y * 18,
      duration: 0.9,
      ease: 'power3.out',
      overwrite: true,
    });

    gsap.to(ambientCool, {
      x: -x * 24,
      y: -y * 16,
      duration: 0.9,
      ease: 'power3.out',
      overwrite: true,
    });

    gsap.utils.toArray('.contact-stack-card').forEach((card, index) => {
      const direction = index === 1 ? -1 : index === 2 ? 0.45 : 1;
      gsap.to(card, {
        x: x * (6 + index * 1.8) * direction,
        y: y * (4 + index * 1.4),
        duration: 0.75,
        ease: 'power3.out',
        overwrite: true,
      });
    });
  });

  stage.addEventListener('pointerleave', () => {
    gsap.to(flow, {
      x: 0,
      y: 0,
      duration: 0.85,
      ease: 'power3.out',
    });

    gsap.to([ambientWarm, ambientCool], {
      x: 0,
      y: 0,
      duration: 0.95,
      ease: 'power3.out',
    });

    gsap.utils.toArray('.contact-stack-card').forEach((card) => {
      gsap.to(card, {
        x: 0,
        y: 0,
        duration: 0.85,
        ease: 'power3.out',
      });
    });
  });
}

async function copyFeedbackDraft(text) {
  try {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    return false;
  }
}

function setupContactForm() {
  const form = document.getElementById('contactForm');
  const nameInput = document.getElementById('contactName');
  const emailInput = document.getElementById('contactEmail');
  const subjectInput = document.getElementById('contactSubject');
  const messageInput = document.getElementById('contactMessage');
  const status = document.getElementById('contactStatus');
  const actions = document.getElementById('contactActions');
  const gmailDraftLink = document.getElementById('contactGmailDraft');
  const mailAppLink = document.getElementById('contactMailApp');
  const copyMessageButton = document.getElementById('contactCopyMessage');

  if (!form || !nameInput || !emailInput || !subjectInput || !messageInput || !status || !actions || !gmailDraftLink || !mailAppLink || !copyMessageButton) {
    return;
  }

  let latestDraftText = '';

  const setStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };

  copyMessageButton.addEventListener('click', async () => {
    if (!latestDraftText) {
      setStatus('Write a quick message first, then we can prepare it for copy or email.', 'error');
      messageInput.focus();
      return;
    }

    const copied = await copyFeedbackDraft(latestDraftText);
    setStatus(copied ? 'Your prepared message is copied. You can paste it into any mail app.' : 'Clipboard access is blocked here. Use the draft links instead.', copied ? 'success' : 'error');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = nameInput.value.trim() || 'GiftAI visitor';
    const email = emailInput.value.trim();
    const subject = subjectInput.value.trim() || 'GiftAI Atelier inquiry';
    const message = messageInput.value.trim() || 'Hello, I would like to share feedback or discuss a custom gifting idea.';

    if (!messageInput.value.trim()) {
      setStatus('Add a short message first so we know what you want to improve.', 'error');
      messageInput.focus();
      return;
    }

    const body = [
      `Name: ${name}`,
      `Email: ${email || 'Not provided'}`,
      '',
      message,
    ].join('\n');

    const gmailLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent('hello@giftaiatelier.com')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const mailtoLink = `mailto:hello@giftaiatelier.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const draftText = `To: hello@giftaiatelier.com\nSubject: ${subject}\n\n${body}`;
    let gmailDraftOpened = false;

    latestDraftText = draftText;
    gmailDraftLink.href = gmailLink;
    mailAppLink.href = mailtoLink;
    actions.hidden = false;

    try {
      const gmailWindow = window.open(gmailLink, '_blank', 'noopener,noreferrer');
      gmailDraftOpened = Boolean(gmailWindow);
    } catch (error) {
      gmailDraftOpened = false;
    }

    const copied = await copyFeedbackDraft(draftText);

    if (gmailDraftOpened) {
      setStatus(copied ? 'Your Gmail draft is ready, and the message is copied as backup.' : 'Your Gmail draft is ready in a new tab.', 'success');
      form.reset();
      return;
    }

    if (copied) {
      setStatus('Your message is copied, and the draft buttons below are ready if the browser did not open Gmail automatically.', 'success');
      form.reset();
      return;
    }

    setStatus('We could not open a draft automatically. Use the buttons below or email hello@giftaiatelier.com directly.', 'error');
  });
}

function setupScrollAnimations() {
  if (reducedMotion) {
    return;
  }

  gsap.to('.orb-1', {
    y: 80,
    x: -34,
    scrollTrigger: {
      trigger: '.hero-stage',
      start: 'top top',
      end: 'bottom top',
      scrub: 1,
    },
  });

  gsap.to('.orb-2', {
    y: -64,
    x: 38,
    scrollTrigger: {
      trigger: '.hero-stage',
      start: 'top top',
      end: 'bottom top',
      scrub: 1.2,
    },
  });

  gsap.from('.glass-panel', {
    y: 54,
    opacity: 0,
    duration: 0.9,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.glass-panel',
      start: 'top 82%',
    },
  });

  gsap.from('.point-card', {
    y: 34,
    opacity: 0,
    duration: 0.7,
    stagger: 0.12,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.panel-points',
      start: 'top 84%',
    },
  });

  gsap.from('.studio-card > *', {
    y: 24,
    opacity: 0,
    duration: 0.62,
    stagger: 0.08,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.studio-card',
      start: 'top 86%',
    },
  });

  gsap.utils.toArray('.section-header').forEach((header) => {
    const children = header.querySelectorAll('.section-kicker, .section-title');
    gsap.from(children, {
      y: 32,
      opacity: 0,
      duration: 0.75,
      stagger: 0.1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: header,
        start: 'top 85%',
      },
    });
  });

  gsap.utils.toArray('.collection-card').forEach((card, index) => {
    gsap.from(card, {
      y: 42,
      opacity: 0,
      rotateY: index % 2 === 0 ? 8 : -8,
      duration: 0.8,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: card,
        start: 'top 84%',
      },
    });

    const image = card.querySelector('.collection-card__image');
    if (image) {
      gsap.to(image, {
        yPercent: -8,
        ease: 'none',
        scrollTrigger: {
          trigger: card,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.2,
        },
      });
    }
  });

  gsap.from('.feature-card', {
    y: 46,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.features-grid',
      start: 'top 84%',
    },
  });

  gsap.from('.timeline-step', {
    y: 48,
    opacity: 0,
    duration: 0.76,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.timeline',
      start: 'top 84%',
    },
  });

  gsap.from('.contact-grid > *', {
    y: 42,
    opacity: 0,
    duration: 0.78,
    stagger: 0.14,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.contact-grid',
      start: 'top 84%',
    },
  });

  gsap.from('.footer-shell', {
    y: 36,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.app-footer',
      start: 'top 88%',
    },
  });
}

function setupTagInteractions() {
  document.querySelectorAll('.tag').forEach((tag) => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('selected');
    });
  });
}

function setupGenerator(bindCursorTargets, bindTilts) {
  const generateButton = document.getElementById('generateBtn');
  const buttonText = document.querySelector('.btn-text');
  const resultsArea = document.getElementById('resultsArea');
  const profileInput = document.getElementById('recipientName');

  if (!generateButton || !buttonText || !resultsArea || !profileInput) {
    return;
  }

  profileInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      generateButton.click();
    }
  });

  generateButton.addEventListener('click', async () => {
    const profile = profileInput.value.trim() || 'someone thoughtful';
    const selectedTags = Array.from(document.querySelectorAll('.tag.selected')).map((tag) => tag.textContent.trim());
    const contextLabel = selectedTags[0] || 'Tailored pick';
    const shouldScroll = resultsArea.classList.contains('hidden');

    buttonText.textContent = 'Curating your shortlist...';
    generateButton.disabled = true;
    generateButton.style.opacity = '0.82';

    renderLoadingCards(resultsArea, contextLabel);

    if (shouldScroll) {
      resultsArea.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

      if (!apiKey || apiKey === 'your_api_key_here') {
        throw new Error('Missing Gemini API key');
      }

      const items = await requestGiftIdeas(apiKey, profile, selectedTags);
      renderResults(items, resultsArea, contextLabel, bindCursorTargets, bindTilts);
    } catch (error) {
      console.warn('Falling back to mock data:', error);
      renderResults(FALLBACK_ITEMS, resultsArea, contextLabel, bindCursorTargets, bindTilts);
    } finally {
      buttonText.textContent = 'Generate Gift Ideas';
      generateButton.disabled = false;
      generateButton.style.opacity = '1';
    }
  });
}

function renderLoadingCards(resultsArea, contextLabel) {
  resultsArea.classList.remove('hidden');
  resultsArea.innerHTML = Array.from({ length: 3 }, () => {
    return `
      <article class="result-card result-card--loading">
        <div class="skeleton skeleton-media"></div>
        <div class="result-card__body">
          <span class="result-card__eyebrow">${escapeHtml(contextLabel)}</span>
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line skeleton-line--short"></div>
        </div>
        <div class="result-card__footer">
          <div class="skeleton skeleton-price"></div>
          <div class="skeleton skeleton-cta"></div>
        </div>
      </article>
    `;
  }).join('');
}

async function requestGiftIdeas(apiKey, profile, selectedTags) {
  const prompt = buildPrompt(profile, selectedTags);
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    );

    if (response.ok) {
      const data = await response.json();
      const responseText = cleanModelResponse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
      const parsed = JSON.parse(responseText);

      if (!Array.isArray(parsed)) {
        throw new Error('Model response was not an array');
      }

      return parsed;
    }

    if (response.status === 429 || response.status === 503) {
      attempt += 1;

      if (attempt >= maxRetries) {
        throw new Error(`Model temporarily unavailable (${response.status})`);
      }

      await new Promise((resolve) => window.setTimeout(resolve, attempt * 1400));
      continue;
    }

    throw new Error(`Model request failed: ${response.status} ${response.statusText}`);
  }

  throw new Error('Unable to get model response');
}

function buildPrompt(profile, selectedTags) {
  const tagText = selectedTags.length ? selectedTags.join(', ') : 'No explicit tags selected';
  const imageList = Array.from(ALLOWED_IMAGES).join(', ');

  return [
    'You are a premium gift concierge.',
    `Create 4 to 6 gift ideas for this recipient: "${profile}".`,
    `Use this context: "${tagText}".`,
    'Return JSON only. No markdown. No commentary.',
    'Return an array of objects. Each object must have exactly these properties:',
    '- "title": short gift name.',
    '- "desc": one sentence, polished and specific.',
    `- "img": choose exactly one image path from this list: ${imageList}.`,
    '- "p": an array of 4 realistic INR prices as integers for Amazon, Flipkart, Myntra, and Meesho.',
  ].join('\n');
}

function cleanModelResponse(text) {
  return text.replace(/^\s*```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function renderResults(items, resultsArea, contextLabel, bindCursorTargets, bindTilts) {
  const normalizedItems = items.slice(0, 6).map((item, index) => normalizeItem(item, index));

  resultsArea.classList.remove('hidden');
  resultsArea.innerHTML = normalizedItems
    .map((item, index) => {
      const label = RESULT_LABELS[index % RESULT_LABELS.length];
      const bestPrice = Math.min(...item.p).toLocaleString('en-IN');

      return `
        <article class="result-card zoom-in-hover" data-index="${index}">
          <div class="result-card__media">
            <img src="${item.img}" alt="${escapeHtml(item.title)}" class="card-img" />
            <span class="result-chip">${escapeHtml(label)}</span>
          </div>
          <div class="result-card__body">
            <span class="result-card__eyebrow">${escapeHtml(contextLabel)}</span>
            <h3 class="result-title">${escapeHtml(item.title)}</h3>
            <p class="result-desc">${escapeHtml(item.desc)}</p>
          </div>
          <div class="result-card__footer">
            <span class="result-price">From INR ${bestPrice}</span>
            <span class="result-cta">View details</span>
          </div>
        </article>
      `;
    })
    .join('');

  window.currentMockItems = normalizedItems;
  const cards = resultsArea.querySelectorAll('.result-card');
  bindCursorTargets(cards);
  bindTilts(cards);

  if (!reducedMotion) {
    gsap.from(cards, {
      y: 24,
      opacity: 0,
      duration: 0.6,
      stagger: 0.1,
      ease: 'power3.out',
    });
  }
}

function normalizeItem(item, index) {
  const fallback = FALLBACK_ITEMS[index % FALLBACK_ITEMS.length];
  const title = sanitizeText(item?.title, fallback.title, 80);
  const desc = sanitizeText(item?.desc, fallback.desc, 180);
  const img = typeof item?.img === 'string' && ALLOWED_IMAGES.has(item.img) ? item.img : fallback.img;
  const p = normalizePrices(item?.p, fallback.p);

  return { title, desc, img, p };
}

function sanitizeText(value, fallback, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  return value.trim().slice(0, maxLength);
}

function normalizePrices(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const prices = value
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .slice(0, 4);

  return prices.length === 4 ? prices : fallback;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return character;
    }
  });
}

function setupModal() {
  const modalOverlay = document.getElementById('productModal');
  const modalContent = modalOverlay?.querySelector('.modal-content');
  const closeButton = document.getElementById('closeModal');
  const modalImg = document.getElementById('modalImg');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const priceGraph = document.getElementById('priceGraph');
  const resultsArea = document.getElementById('resultsArea');
  const collectionCards = document.querySelectorAll('.collection-card[data-curated-key]');

  if (!modalOverlay || !modalContent || !closeButton || !modalImg || !modalTitle || !modalDesc || !priceGraph || !resultsArea) {
    return;
  }

  const platformButtons = {
    amazon: document.querySelector('.platform-btn.amazon'),
    flipkart: document.querySelector('.platform-btn.flipkart'),
    myntra: document.querySelector('.platform-btn.myntra'),
    meesho: document.querySelector('.platform-btn.meesho'),
  };

  Object.values(platformButtons).forEach((button) => {
    if (button) {
      button.target = '_blank';
      button.rel = 'noreferrer noopener';
    }
  });

  const openModal = () => {
    modalOverlay.classList.remove('hidden');

    if (reducedMotion) {
      return;
    }

    gsap.killTweensOf([modalOverlay, modalContent]);
    gsap.fromTo(
      modalOverlay,
      { opacity: 0 },
      { opacity: 1, duration: 0.24, ease: 'power1.out' },
    );
    gsap.fromTo(
      modalContent,
      { opacity: 0, y: 30, scale: 0.95, rotateX: -7 },
      { opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 0.55, ease: 'power3.out' },
    );
  };

  const presentItem = (item) => {
    if (!item) {
      return;
    }

    modalImg.src = item.img;
    modalTitle.textContent = item.title;
    modalDesc.textContent = item.desc;

    const storeQuery = item.searchTerm || item.title;

    if (platformButtons.amazon) {
      platformButtons.amazon.href = `https://www.amazon.in/s?k=${encodeURIComponent(storeQuery)}`;
    }

    if (platformButtons.flipkart) {
      platformButtons.flipkart.href = `https://www.flipkart.com/search?q=${encodeURIComponent(storeQuery)}`;
    }

    if (platformButtons.myntra) {
      platformButtons.myntra.href = `https://www.myntra.com/${encodeURIComponent(storeQuery)}`;
    }

    if (platformButtons.meesho) {
      platformButtons.meesho.href = `https://www.meesho.com/search?q=${encodeURIComponent(storeQuery)}`;
    }

    const maxPrice = Math.max(...item.p);
    priceGraph.innerHTML = item.p
      .map((price, index) => {
        const width = Math.round((price / maxPrice) * 100);
        return `
          <div class="graph-bar-row">
            <div class="bar-label">${PLATFORM_NAMES[index]}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width: 0%" data-target="${width}%"></div>
            </div>
            <div class="bar-price">INR ${price.toLocaleString('en-IN')}</div>
          </div>
        `;
      })
      .join('');

    openModal();

    const bars = priceGraph.querySelectorAll('.bar-fill');
    if (reducedMotion) {
      bars.forEach((bar) => {
        bar.style.width = bar.getAttribute('data-target') || '0%';
      });
      return;
    }

    gsap.to(bars, {
      width: (_, element) => element.getAttribute('data-target') || '0%',
      duration: 0.9,
      stagger: 0.08,
      ease: 'power3.out',
    });
  };

  const closeModal = () => {
    if (modalOverlay.classList.contains('hidden')) {
      return;
    }

    if (reducedMotion) {
      modalOverlay.classList.add('hidden');
      return;
    }

    gsap.killTweensOf([modalOverlay, modalContent]);
    gsap.to(modalContent, {
      opacity: 0,
      y: 24,
      scale: 0.97,
      rotateX: -5,
      duration: 0.24,
      ease: 'power2.in',
    });
    gsap.to(modalOverlay, {
      opacity: 0,
      duration: 0.2,
      ease: 'power1.out',
      onComplete: () => {
        modalOverlay.classList.add('hidden');
        gsap.set(modalOverlay, { clearProps: 'opacity' });
        gsap.set(modalContent, { clearProps: 'opacity,transform' });
      },
    });
  };

  closeButton.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });

  resultsArea.addEventListener('click', (event) => {
    const card = event.target.closest('.result-card');

    if (!card || card.classList.contains('result-card--loading') || !window.currentMockItems) {
      return;
    }

    const item = window.currentMockItems[Number(card.dataset.index)];
    presentItem(item);
  });

  collectionCards.forEach((card) => {
    const openCuratedCollection = () => {
      const item = CURATED_COLLECTIONS[card.dataset.curatedKey || ''];
      presentItem(item);
    };

    card.addEventListener('click', openCuratedCollection);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCuratedCollection();
      }
    });
  });
}

function setupCube(stage) {
  const cube = document.querySelector('.cube');

  if (!cube) {
    return;
  }

  if (reducedMotion) {
    cube.style.transform = 'rotateX(-14deg) rotateY(24deg)';
    return;
  }

  let pointerX = 0;
  let pointerY = 0;
  let currentX = -14;
  let currentY = 18;
  let autoSpin = 0;
  const stagePointerEnabled = Boolean(stage) && window.matchMedia('(pointer: fine) and (min-width: 1025px)').matches;

  if (stagePointerEnabled && stage) {
    let stageRect = stage.getBoundingClientRect();
    const updateRect = () => {
      stageRect = stage.getBoundingClientRect();
    };

    stage.addEventListener('pointerenter', updateRect, { passive: true });
    window.addEventListener('resize', updateRect, { passive: true });
    stage.addEventListener('pointermove', (event) => {
      pointerX = (event.clientX - stageRect.left) / stageRect.width - 0.5;
      pointerY = (event.clientY - stageRect.top) / stageRect.height - 0.5;
    }, { passive: true });
    stage.addEventListener('pointerleave', () => {
      pointerX = 0;
      pointerY = 0;
    });
  } else if (!stage) {
    document.addEventListener('pointermove', (event) => {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }

  function animateCube() {
    autoSpin = (autoSpin + 0.24) % 360;
    const targetX = -14 - pointerY * 16;
    const targetY = 18 + pointerX * 28;

    currentX += (targetX - currentX) * 0.05;
    currentY += (targetY - currentY) * 0.05;

    cube.style.transform = `rotateX(${currentX}deg) rotateY(${currentY + autoSpin}deg) rotateZ(${pointerX * 5}deg)`;
    window.requestAnimationFrame(animateCube);
  }

  animateCube();
}
