(() => {
  "use strict";

  // Updated list of working Invidious instances (July 2025)
  const INSTANCES = [
    "yewtu.be",
    "invidious.nerdvpn.de",
    "invidious.f5.si",
    "inv1.nadeko.net",
    "inv2.nadeko.net",
    "inv3.nadeko.net",
    "invidious.flokinet.to",
    "iv.melmac.space",
    "invidious.private.coffee"
  ];

  // DOM Elements
  const urlInput = document.getElementById("url-input");
  const loadBtn = document.getElementById("load-btn");
  const playlistEl = document.getElementById("playlist");
  const iframe = document.getElementById("video-player");
  const toast = document.getElementById("toast");
  const instanceSelect = document.getElementById("instance-select");

  let currentInstance = INSTANCES[0];
  let currentPlaylist = [];
  let currentVideoId = null;
  let currentPlaylistId = null;

  // Utility: Show toast notification
  function showToast(message, duration = 3000) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }

  // Utility: Parse YouTube URLs and extract video and playlist IDs
  function parseYouTubeUrl(url) {
    let videoId = null;
    let playlistId = null;

    try {
      const u = new URL(url.trim());

      const hostname = u.hostname.toLowerCase();
      if (
        hostname.endsWith("youtube.com") ||
        hostname === "youtu.be" ||
        hostname === "www.youtu.be" ||
        hostname === "www.youtube.com"
      ) {
        if (hostname === "youtu.be" || hostname === "www.youtu.be") {
          videoId = u.pathname.slice(1);
          playlistId = u.searchParams.get("list");
        } else {
          videoId = u.searchParams.get("v");
          playlistId = u.searchParams.get("list");
        }
      } else {
        return null; // Invalid hostname
      }

      if (!videoId && !playlistId) return null;

      return { videoId, playlistId };
    } catch {
      return null;
    }
  }

  // Populate instance dropdown
  function populateInstanceDropdown() {
    instanceSelect.innerHTML = "";
    INSTANCES.forEach((ins) => {
      const opt = document.createElement("option");
      opt.value = ins;
      opt.textContent = ins;
      if (ins === currentInstance) opt.selected = true;
      instanceSelect.appendChild(opt);
    });
  }

  // API fetch timeout helper
  async function fetchWithTimeout(url, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  }

  // Load playlist by playlistId from current instance
  async function loadPlaylist(playlistId) {
    const url = `https://${currentInstance}/api/v1/playlists/${playlistId}`;
    try {
      showToast(`Loading playlist from ${currentInstance}...`);
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`API response not okay (${res.status})`);
      const playlist = await res.json();
      if (!playlist || !playlist.videos?.length) throw new Error("Empty playlist");
      currentPlaylist = playlist.videos;
      currentPlaylistId = playlistId;
      renderPlaylist();
      playVideo(currentPlaylist[0].videoId);
      showToast(`Playlist loaded (${playlist.title})`);
    } catch (err) {
      showToast(`Failed to load playlist on ${currentInstance}, trying next instance...`);
      failoverInstance(() => loadPlaylist(playlistId));
    }
  }

  // Load single video metadata to display title in sidebar
  async function loadSingleVideo(videoId) {
    const url = `https://${currentInstance}/api/v1/videos/${videoId}`;
    try {
      showToast(`Loading video from ${currentInstance}...`);
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`API response not okay (${res.status})`);
      const video = await res.json();
      currentPlaylist = [{ videoId: video.videoId, title: video.title }];
      currentPlaylistId = null; // Not a playlist
      renderPlaylist();
      playVideo(video.videoId);
      showToast(`Video loaded (${video.title})`);
    } catch (err) {
      showToast(`Failed to load video on ${currentInstance}, trying next instance...`);
      failoverInstance(() => loadSingleVideo(videoId));
    }
  }

  // Render playlist sidebar
  function renderPlaylist() {
    playlistEl.innerHTML = "";
    currentPlaylist.forEach(({ videoId, title }) => {
      const li = document.createElement("li");
      li.textContent = title;
      li.classList.toggle("active", videoId === currentVideoId);
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-pressed", videoId === currentVideoId ? "true" : "false");
      li.addEventListener("click", () => playVideo(videoId));
      li.addEventListener("keypress", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          playVideo(videoId);
          e.preventDefault();
        }
      });
      playlistEl.appendChild(li);
    });
  }

  // Play video in iframe with DASH quality parameter
  function playVideo(videoId) {
    if (currentVideoId === videoId) return;
    currentVideoId = videoId;
    renderPlaylist();

    // Build embed src URL with quality=dash
    const src = `https://${currentInstance}/embed/${videoId}?quality=dash&controls=1&autoplay=1`;

    iframe.src = src;
  }

  // Failover instance: rotate and retry function
  function failoverInstance(callback) {
    let currentIndex = INSTANCES.indexOf(currentInstance);
    for (let i = 1; i <= INSTANCES.length; i++) {
      let nextIndex = (currentIndex + i) % INSTANCES.length;
      const nextInstance = INSTANCES[nextIndex];

      // Try next instance synchronously
      currentInstance = nextInstance;
      instanceSelect.value = currentInstance;

      // Run callback with new instance
      callback();
      return;
    }
    showToast("All instances failed. Please try again later.");
  }

  // Process URL input, validate and load content
  function processInput() {
    const url = urlInput.value.trim();
    if (!url) {
      alert("Please enter a YouTube video or playlist URL.");
      return;
    }
    const parsed = parseYouTubeUrl(url);
    if (!parsed) {
      alert("Invalid YouTube URL or missing video/playlist ID.");
      return;
    }

    if (parsed.playlistId) {
      loadPlaylist(parsed.playlistId);
    } else if (parsed.videoId) {
      loadSingleVideo(parsed.videoId);
    } else {
      alert("Could not find video or playlist ID in URL.");
    }
  }

  // Instance selection changed by user
  function onInstanceChange() {
    const selectedInstance = instanceSelect.value;
    if (INSTANCES.includes(selectedInstance)) {
      currentInstance = selectedInstance;
      if (currentVideoId) {
        // Reload current video with new instance
        playVideo(currentVideoId);
        showToast(`Switched instance to ${currentInstance}`);
      }
      if (currentPlaylistId) {
        // Reload playlist data in background with new instance
        loadPlaylist(currentPlaylistId);
      }
      if (!currentVideoId && !currentPlaylistId) {
        showToast(`Switched instance to ${currentInstance}`);
      }
    }
  }

  // Attach event listeners
  function addEventListeners() {
    loadBtn.addEventListener("click", processInput);
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") processInput();
    });
    instanceSelect.addEventListener("change", onInstanceChange);
  }

  // Initialize app
  function init() {
    populateInstanceDropdown();
    addEventListeners();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
