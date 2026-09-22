document.addEventListener('DOMContentLoaded', () => {
  function createStarField(canvas, { count = 125, color = '255,255,255', speed = 0.12 } = {}) {
    const ctx = canvas.getContext('2d');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width, height, dpr, stars = [], animationFrame = 0;
    let isSectionVisible = Boolean(window.MotionLifecycle) || !('IntersectionObserver' in window);
    let motionAllowed = !window.MotionLifecycle;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const createStars = () => {
      const responsiveCount = Math.round(Math.min(165, Math.max(72, width * height / 8500)));
      const total = Math.min(count, responsiveCount);
      stars = Array.from({ length: total }, () => {
        const intensityRoll = Math.random();
        const intensity = intensityRoll < .56 ? 'soft' : intensityRoll < .9 ? 'medium' : 'bright';
        const radius = intensity === 'soft'
          ? .45 + Math.random() * .45
          : intensity === 'medium'
            ? .8 + Math.random() * .7
            : 1.25 + Math.random() * .85;
        const alpha = intensity === 'soft'
          ? .16 + Math.random() * .16
          : intensity === 'medium'
            ? .36 + Math.random() * .22
            : .68 + Math.random() * .24;
        const angle = Math.random() * Math.PI * 2;
        const drift = speed * (.35 + Math.random() * .75);

        return {
          x: Math.random() * width,
          y: Math.random() * height,
          radius,
          intensity,
          alpha,
          vx: Math.cos(angle) * drift,
          vy: Math.sin(angle) * drift,
          twinkle: Math.random() * Math.PI * 2,
          twinkleSpeed: .008 + Math.random() * .018,
          twinkleRange: intensity === 'bright' ? .2 : .1,
          rotation: Math.random() * Math.PI
        };
      });
    };

    const drawSparkle = (star, alpha) => {
      const outerRadius = star.radius * 2.5;
      const innerRadius = star.radius * .55;
      ctx.save();
      ctx.translate(star.x, star.y);
      ctx.rotate(star.rotation);
      ctx.beginPath();
      for (let point = 0; point < 8; point += 1) {
        const radius = point % 2 === 0 ? outerRadius : innerRadius;
        const angle = point * Math.PI / 4;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${color}, ${alpha})`;
      ctx.shadowColor = `rgba(${color}, ${Math.min(1, alpha + .08)})`;
      ctx.shadowBlur = outerRadius * 2.2;
      ctx.fill();
      ctx.restore();
    };

    const draw = (advance = true) => {
      ctx.clearRect(0, 0, width, height);
      stars.forEach((star) => {
        if (advance) {
          star.x += star.vx;
          star.y += star.vy;
          star.twinkle += star.twinkleSpeed;
          star.rotation += star.intensity === 'bright' ? .0012 : 0;
        }

        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        const twinkleAlpha = Math.max(.08, star.alpha + Math.sin(star.twinkle) * star.twinkleRange);
        if (star.intensity === 'bright') {
          drawSparkle(star, twinkleAlpha);
        } else {
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color}, ${twinkleAlpha})`;
          ctx.fill();
        }
      });
    };

    const animate = () => {
      animationFrame = 0;
      if (document.hidden || reducedMotion.matches || !isSectionVisible || !motionAllowed) return;
      draw(true);
      animationFrame = requestAnimationFrame(animate);
    };

    const start = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      if (document.hidden || reducedMotion.matches || !isSectionVisible || !motionAllowed) {
        draw(false);
        return;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    resize();
    createStars();
    window.addEventListener('resize', () => { resize(); createStars(); start(); });
    document.addEventListener('visibilitychange', start);
    reducedMotion.addEventListener('change', start);

    if (window.MotionLifecycle) {
      window.MotionLifecycle.register(canvas.parentElement, {
        start: () => {
          motionAllowed = true;
          start();
        },
        stop: () => {
          motionAllowed = false;
          start();
        }
      });
    } else if ('IntersectionObserver' in window) {
      const sectionObserver = new IntersectionObserver(([entry]) => {
        isSectionVisible = entry.isIntersecting;
        start();
      });
      sectionObserver.observe(canvas.parentElement);
    }

    start();
  }

  document.querySelectorAll('.particles-canvas').forEach((canvas) => createStarField(canvas));
});
