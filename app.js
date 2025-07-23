/*
 * Invidious Playlist Embedder – app.js (PATCH 2 – reliability + fallback)
 *
 * Changes:
 * 1. Populate instance dropdown immediately with default metrics so users see options.
 * 2. Keep "Scanning…" status visible until first health-check completes.
 * 3. Improve iframe embed logic with a fallback to official YouTube embed if
 *    Invidious instance is blocked (detected via load/error events + timeout).
 * 4. Slightly adjust health-check flow to never block UI population.
 */

/* global utils, APP_DATA, CacheManager, CircuitBreaker, PerformanceTracker */

/*****************************************************************************
 * Ensure dropdown populated with static list ASAP
 *****************************************************************************/
(function preloadUI() {
  const select = document.getElementById('instanceSelect');
  APP_DATA.instances.forEach((ins, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${ins.name}`;
    select.appendChild(opt);
  });
})();

/*****************************************************************************
 * The rest of the script is wrapped in an IIFE to avoid globals pollution
 *****************************************************************************/
(function () {
  /***************************************************************************
   * Utility (re-use previous utils if exists)
   **************************************************************************/
  if (typeof utils === 'undefined') {
    window.utils = {
      fetchWithTimeout: async (
        url,
        { timeout = 10000, mode = 'no-cors', ...options } = {}
      ) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            mode,
            cache: 'no-store'
          });
          clearTimeout(id);
          return response;
        } catch (err) {
          clearTimeout(id);
          throw err;
        }
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    };
  }

  const tracker = new PerformanceTracker();
  const circuit = new CircuitBreaker(
    APP_DATA.healthCheck.maxFailures,
    APP_DATA.healthCheck.blacklistDuration
  );

  /***************************************************************************
   * InstanceRotator (reuse or define)
   **************************************************************************/
  class InstanceRotatorClass {
    constructor(instances) {
      this.instances = instances;
      this.currentIndex = 0;
    }
    sortInstances() {
      this.instances.sort((a, b) => {
        const rateA = tracker.successRate(a.url);
        const rateB = tracker.successRate(b.url);
        const rtA = tracker.avgResponse(a.url);
        const rtB = tracker.avgResponse(b.url);
        if (rateA !== rateB) return rateB - rateA;
        return rtA - rtB;
      });
      if (this.currentIndex >= this.instances.length) this.currentIndex = 0;
      UI.updateInstanceSelect(this.instances);
    }
    current() {
      return this.instances[this.currentIndex];
    }
    async getHealthyInstance() {
      for (let i = 0; i < this.instances.length; i++) {
        const idx = (this.currentIndex + i) % this.instances.length;
        const ins = this.instances[idx];
        if (!circuit.isOpen(ins.url)) return ins;
      }
      return this.instances[0];
    }
    async failAndRotate() {
      circuit.recordFailure(this.current().url);
      let tries = 0;
      while (tries < this.instances.length) {
        this.currentIndex = (this.currentIndex + 1) % this.instances.length;
        if (!circuit.isOpen(this.current().url)) break;
        tries++;
      }
      UI.updateActiveInstance(this.current());
    }
  }
  const InstanceRotator = new InstanceRotatorClass(APP_DATA.instances);

  /***************************************************************************
   * Health Monitor (unchanged logic but async)
   **************************************************************************/
  class InstanceHealthMonitor {
    constructor(instances) {
      this.instances = instances.map((i) => ({ ...i }));
    }
    async check(instance) {
      const url = `https://${instance.url}${APP_DATA.healthCheck.endpoint}`;
      const start = performance.now();
      try {
        const res = await utils.fetchWithTimeout(url, {
          timeout: APP_DATA.healthCheck.timeout,
          mode: 'no-cors'
        });
        const elapsed = performance.now() - start;
        const ok = res.ok || res.type === 'opaque';
        tracker.addResult(instance.url, elapsed, ok);
        ok ? circuit.recordSuccess(instance.url) : circuit.recordFailure(instance.url);
      } catch (_) {
        tracker.addResult(instance.url, null, false);
        circuit.recordFailure(instance.url);
      }
    }
    async checkAll() {
      await Promise.all(this.instances.map((ins) => this.check(ins)));
    }
    startBackground(intervalMs = APP_DATA.healthCheck.interval) {
      setInterval(() => {
        this.checkAll().then(() => InstanceRotator.sortInstances());
      }, intervalMs);
    }
  }

  /***************************************************************************
   * UI utilities
   **************************************************************************/
  const UI = {
    dot: document.getElementById('instanceDot'),
    activeName: document.getElementById('activeInstanceName'),
    statusMsg: document.getElementById('statusMessage'),
    instanceSelect: document.getElementById('instanceSelect'),
    playerFrame: document.getElementById('playerFrame'),
    loadBtn: document.getElementById('loadBtn'),

    setDot(cls) {
      this.dot.classList.remove('indicator-healthy', 'indicator-unhealthy', 'indicator-unknown');
      this.dot.classList.add(cls);
    },
    showStatus(text, type = 'info') {
      this.statusMsg.textContent = text;
      this.statusMsg.className = `status status--${type}`;
      this.statusMsg.classList.remove('hidden');
    },
    hideStatus() {
      this.statusMsg.classList.add('hidden');
    },
    updateActiveInstance(instance) {
      this.activeName.textContent = instance ? instance.name : 'Unknown';
      const rate = tracker.successRate(instance.url);
      const cls = rate > 0.8 ? 'indicator-healthy' : rate > 0.4 ? 'indicator-unknown' : 'indicator-unhealthy';
      this.setDot(cls);
    },
    updateInstanceSelect(instances) {
      // Remove existing (keep Automatic)
      this.instanceSelect.querySelectorAll('option:not(:first-child)').forEach((o) => o.remove());
      instances.forEach((ins, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        const rt = tracker.avgResponse(ins.url);
        const rate = tracker.successRate(ins.url);
        const rtDisp = rt === Infinity ? '–' : `${Math.round(rt)}ms`;
        const rateDisp = rate ? `${Math.round(rate * 100)}%` : '–';
        opt.textContent = `${ins.name} (${rtDisp}, ${rateDisp})`;
        this.instanceSelect.appendChild(opt);
      });
    }
  };

  /***************************************************************************
   * Embed logic with fallback
   **************************************************************************/
  function attemptEmbed(instance, youtubeUrl) {
    return new Promise((resolve, reject) => {
      const embedUrl = buildEmbedUrl(instance.url, youtubeUrl);
      if (!embedUrl) return reject(new Error('Invalid YouTube URL'));

      // Reset iframe
      UI.playerFrame.classList.remove('hidden');
      UI.playerFrame.src = embedUrl;

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Embed timeout, falling back'));
        }
      }, 8000);

      const onLoad = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      const onError = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Embed error'));
        }
      };
      UI.playerFrame.addEventListener('load', onLoad, { once: true });
      UI.playerFrame.addEventListener('error', onError, { once: true });
    });
  }

  function fallbackToYoutube(youtubeUrl) {
    try {
      const url = new URL(youtubeUrl);
      const videoId = url.searchParams.get('v') || url.pathname.split('/').pop();
      if (!videoId) return false;
      UI.playerFrame.src = `https://www.youtube.com/embed/${videoId}`;
      return true;
    } catch {
      return false;
    }
  }

  /***************************************************************************
   * Initialisation + event handlers
   **************************************************************************/
  async function initialise() {
    UI.showStatus('Scanning instances…', 'info');
    const monitor = new InstanceHealthMonitor(InstanceRotator.instances);
    await monitor.checkAll();
    InstanceRotator.sortInstances();
    UI.updateActiveInstance(InstanceRotator.current());
    UI.showStatus('Ready', 'success');
    setTimeout(() => UI.hideStatus(), 4000);
    monitor.startBackground(APP_DATA.healthCheck.interval);
  }

  document.addEventListener('DOMContentLoaded', initialise);

  UI.loadBtn.addEventListener('click', async () => {
    const youtubeUrl = document.getElementById('urlInput').value.trim();
    if (!youtubeUrl) return;
    UI.showStatus('Loading video…', 'info');
    try {
      if (UI.instanceSelect.value) {
        InstanceRotator.currentIndex = parseInt(UI.instanceSelect.value, 10);
      }
      const instance = await InstanceRotator.getHealthyInstance();
      UI.updateActiveInstance(instance);

      await attemptEmbed(instance, youtubeUrl);
      UI.hideStatus();
    } catch (err) {
      console.warn(err.message);
      // If embed failed, try fallback to YouTube directly
      if (fallbackToYoutube(youtubeUrl)) {
        UI.showStatus('Fell back to YouTube embed', 'warning');
      } else {
        UI.showStatus('Retrying with next instance…', 'error');
        await InstanceRotator.failAndRotate();
        await utils.sleep(1000);
        UI.loadBtn.click();
      }
    }
  });

  /***************************************************************************
   * Embed URL builder (unchanged)
   **************************************************************************/
  function buildEmbedUrl(instanceDomain, youtubeUrl) {
    try {
      const url = new URL(youtubeUrl);
      const videoId = url.searchParams.get('v');
      const playlistId = url.searchParams.get('list');
      let embedPath = null;
      if (playlistId && !videoId) {
        embedPath = `/embed/videoseries?list=${playlistId}`;
      } else if (videoId) {
        embedPath = `/embed/${videoId}`;
        if (playlistId) embedPath += `?playlist=${playlistId}`;
      } else if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/shorts/')[1].split(/[?/]/)[0];
        embedPath = `/embed/${id}`;
      }
      return embedPath ? `https://${instanceDomain}${embedPath}` : null;
    } catch {
      return null;
    }
  }
})();
