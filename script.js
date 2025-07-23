const instances = [
  'yewtu.be',
  'yewtu.eu',
  'yewtu.ggc-project.de',
  'yewtu.cafe',
  'yewtu.pet'
];
let currentInstanceIndex = 0;

function failover() {
  currentInstanceIndex = (currentInstanceIndex + 1) % instances.length;
  loadCurrentVideo();
}

let videoIds = [];
let currentVid = '';

function parseId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Only accept YouTube domains
    if (!/(^|\.)youtube\.com$/.test(host) && host !== 'youtu.be') {
      alert('Please enter a valid YouTube video or playlist URL.');
      return null;
    }
    if (u.searchParams.has('list')) return { type: 'playlist', id: u.searchParams.get('list') };
    if (u.searchParams.has('v')) return { type: 'video', id: u.searchParams.get('v') };
    // youtu.be short link
    const m = url.match(/youtu\.be\/([^?&]+)/);
    if (m) return { type: 'video', id: m[1] };

    alert('Could not extract video or playlist ID.');
    return null;
  } catch (e) {
    alert('Invalid URL format.');
    return null;
  }
}

async function loadPlaylist(listId) {
  const apiBase = `https://${instances[currentInstanceIndex]}/api/v1/playlists/${listId}`;
  try {
    const res = await fetch(apiBase);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    videoIds = data.videos.map(v => v.videoId);
    populateSidebar(data.videos);
    playVideo(videoIds[0]);
  } catch (e) {
    console.warn('Playlist load error, switching instance', e);
    currentInstanceIndex = (currentInstanceIndex + 1) % instances.length;
    loadPlaylist(listId);
  }
}

function populateSidebar(videos) {
  const ul = document.getElementById('videoList');
  ul.innerHTML = '';
  videos.forEach(v => {
    const li = document.createElement('li');
    li.textContent = v.title;
    li.onclick = () => playVideo(v.videoId);
    ul.appendChild(li);
  });
}

function playVideo(id) {
  currentVid = id;
  loadCurrentVideo();
}

function loadCurrentVideo() {
  const inst = instances[currentInstanceIndex];
  const iframe = document.getElementById('player');
  iframe.src = `https://${inst}/embed/${currentVid}`;
  iframe.onerror = failover;
}

document.getElementById('loadBtn').onclick = () => {
  currentInstanceIndex = 0;
  const input = document.getElementById('playlistUrl').value.trim();
  const parsed = parseId(input);
  if (!parsed) return;
  if (parsed.type === 'playlist') loadPlaylist(parsed.id);
  else playVideo(parsed.id);
};
