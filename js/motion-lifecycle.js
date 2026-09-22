(() => {
  'use strict';

  const ACTIVE_MS = 18000;
  const REST_MS = 8000;
  const controllers = new Set();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const supportsIntersectionObserver = 'IntersectionObserver' in window;

  const pauseStyle = document.createElement('style');
  pauseStyle.textContent = `
    .motion-runtime-paused,
    .motion-runtime-paused::before,
    .motion-runtime-paused::after {
      animation-play-state: paused !important;
    }
  `;
  document.head.appendChild(pauseStyle);

  const canRun = (controller) => (
    !document.hidden
    && !reducedMotion.matches
    && controller.isVisible
  );

  const clearTimer = (controller) => {
    if (!controller.timer) return;
    window.clearTimeout(controller.timer);
    controller.timer = 0;
  };

  const invoke = (callback) => {
    try {
      callback?.();
    } catch (error) {
      console.error('No se pudo actualizar un efecto de movimiento.', error);
    }
  };

  const suspend = (controller, state = 'paused') => {
    clearTimer(controller);
    if (controller.state !== state) invoke(controller.stop);
    controller.state = state;
  };

  const beginActivePhase = (controller) => {
    clearTimer(controller);
    if (!canRun(controller)) {
      suspend(controller, reducedMotion.matches ? 'reduced-motion' : (document.hidden ? 'hidden' : 'offscreen'));
      return;
    }

    controller.state = 'active';
    invoke(controller.start);
    controller.timer = window.setTimeout(() => {
      controller.state = 'resting';
      invoke(controller.stop);
      controller.timer = window.setTimeout(() => beginActivePhase(controller), controller.restMs);
    }, controller.activeMs);
  };

  const sync = (controller) => {
    if (canRun(controller)) {
      if (controller.state !== 'active' && controller.state !== 'resting') beginActivePhase(controller);
      return;
    }
    suspend(controller, reducedMotion.matches ? 'reduced-motion' : (document.hidden ? 'hidden' : 'offscreen'));
  };

  const observer = supportsIntersectionObserver
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.__motionLifecycleControllers?.forEach((controller) => {
          controller.isVisible = entry.isIntersecting
            && entry.intersectionRect.width > 0
            && entry.intersectionRect.height > 0;
          sync(controller);
        });
      });
    }, { threshold: 0 })
    : null;

  const register = (target, options = {}) => {
    if (!(target instanceof Element)) return () => {};

    const controller = {
      target,
      start: options.start,
      stop: options.stop,
      activeMs: Number.isFinite(options.activeMs) ? options.activeMs : ACTIVE_MS,
      restMs: Number.isFinite(options.restMs) ? options.restMs : REST_MS,
      isVisible: !supportsIntersectionObserver,
      state: 'idle',
      timer: 0,
      observer
    };

    controllers.add(controller);
    target.__motionLifecycleControllers ??= [];
    target.__motionLifecycleControllers.push(controller);
    observer?.observe(target);
    sync(controller);

    return () => {
      clearTimer(controller);
      invoke(controller.stop);
      controllers.delete(controller);
      target.__motionLifecycleControllers = target.__motionLifecycleControllers
        ?.filter(item => item !== controller);
      if (!target.__motionLifecycleControllers?.length) observer?.unobserve(target);
    };
  };

  const hasInfiniteAnimation = (element, pseudo = null) => {
    const style = window.getComputedStyle(element, pseudo);
    const names = style.animationName.split(',').map(value => value.trim());
    const iterations = style.animationIterationCount.split(',').map(value => value.trim());
    return names.some((name, index) => (
      name !== 'none'
      && iterations[index % iterations.length] === 'infinite'
    ));
  };

  const discoverCssAnimations = () => {
    const groups = new Map();
    const addToScope = (element) => {
      if (!(element instanceof Element) || element.closest('.loading-overlay, [data-motion-unmanaged]')) return;
      const scope = element.closest('[data-motion-scope], section, header, footer, main') || element;
      if (!groups.has(scope)) groups.set(scope, new Set());
      groups.get(scope).add(element);
    };

    if (typeof document.getAnimations === 'function') {
      document.getAnimations({ subtree: true }).forEach((animation) => {
        const timing = animation.effect?.getTiming?.();
        if (timing?.iterations !== Infinity) return;
        const effectTarget = animation.effect?.target;
        const element = effectTarget instanceof Element ? effectTarget : effectTarget?.element;
        addToScope(element);
      });
    } else {
      const elements = [document.body, ...document.body.querySelectorAll('*')];
      elements.forEach((element) => {
        if (element.closest('.loading-overlay, [data-motion-unmanaged]')) return;
        let isContinuous = false;
        try {
          isContinuous = hasInfiniteAnimation(element)
            || hasInfiniteAnimation(element, '::before')
            || hasInfiniteAnimation(element, '::after');
        } catch (_) {
          return;
        }
        if (isContinuous) addToScope(element);
      });
    }

    groups.forEach((elementsInScope, scope) => {
      register(scope, {
        start: () => elementsInScope.forEach(element => element.classList.remove('motion-runtime-paused')),
        stop: () => elementsInScope.forEach(element => element.classList.add('motion-runtime-paused'))
      });
    });
  };

  const discoverAnimatedImages = () => {
    const groups = new Map();
    document.querySelectorAll('[data-motion-animated-src][data-motion-static-src]').forEach((image) => {
      const scope = image.closest('[data-motion-scope], section, header, footer, main') || image;
      if (!groups.has(scope)) groups.set(scope, []);
      groups.get(scope).push(image);
    });

    groups.forEach((images, scope) => {
      const showStaticFrame = () => images.forEach((image) => {
        if (image.getAttribute('src') !== image.dataset.motionStaticSrc) {
          image.src = image.dataset.motionStaticSrc;
        }
      });
      register(scope, {
        start: () => images.forEach((image) => {
          if (image.getAttribute('src') !== image.dataset.motionAnimatedSrc) {
            image.src = image.dataset.motionAnimatedSrc;
          }
        }),
        stop: showStaticFrame
      });
      showStaticFrame();
    });
  };

  const syncAll = () => controllers.forEach(sync);
  document.addEventListener('visibilitychange', syncAll);
  reducedMotion.addEventListener('change', syncAll);

  window.MotionLifecycle = Object.freeze({
    register,
    activeMs: ACTIVE_MS,
    restMs: REST_MS,
    getStates: () => [...controllers].map(({ target, state, isVisible }) => ({ target, state, isVisible }))
  });

  const initialize = () => {
    discoverAnimatedImages();
    window.requestAnimationFrame(discoverCssAnimations);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
