
class InvidiousPlaylistEmbedder {
    constructor() {
        // Updated list with more reliable instances and numbered backends for nadeko.net
        this.instances = [
            'yewtu.be',
            'invidious.nerdvpn.de',
            'invidious.flokinet.to',
            'invidious.privacydev.net',
            'iv.melmac.space',
            'inv1.nadeko.net',  // Primary nadeko backend
            'inv2.nadeko.net',  // Secondary nadeko backend  
            'inv3.nadeko.net',  // Tertiary nadeko backend
            'invidious.f5.si'   // New Japanese instance
        ];

        this.currentInstanceIndex = 0;
        this.currentPlaylist = [];
        this.currentVideoIndex = 0;

        this.initializeEventListeners();
        this.displayCurrentInstance();
    }

    initializeEventListeners() {
        const loadButton = document.getElementById('loadButton');
        const urlInput = document.getElementById('urlInput');

        loadButton.addEventListener('click', () => this.handleLoad());
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleLoad();
            }
        });
    }

    displayCurrentInstance() {
        const status = document.getElementById('status');
        status.textContent = `Current instance: ${this.instances[this.currentInstanceIndex]}`;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        // Style the toast
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            color: 'white',
            fontWeight: 'bold',
            zIndex: '10000',
            opacity: '0',
            transition: 'opacity 0.3s ease',
            backgroundColor: type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#3498db'
        });

        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (document.body.contains(toast)) {
                    document.body.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    validateUrl(url) {
        try {
            const urlObj = new URL(url);

            // Check if hostname is YouTube
            if (!urlObj.hostname.endsWith('youtube.com') && urlObj.hostname !== 'youtu.be') {
                return null;
            }

            // Extract video ID or playlist ID
            let videoId = null;
            let playlistId = null;

            if (urlObj.hostname === 'youtu.be') {
                // Short URL format: https://youtu.be/VIDEO_ID
                videoId = urlObj.pathname.substring(1);
            } else if (urlObj.hostname.endsWith('youtube.com')) {
                // Long URL format
                const searchParams = urlObj.searchParams;
                videoId = searchParams.get('v');
                playlistId = searchParams.get('list');
            }

            return { videoId, playlistId };
        } catch (error) {
            return null;
        }
    }

    async fetchWithTimeout(url, timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    async tryNextInstance() {
        this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.instances.length;
        this.displayCurrentInstance();
        this.showToast(`Switched to instance: ${this.instances[this.currentInstanceIndex]}`, 'info');
        return this.instances[this.currentInstanceIndex];
    }

    async fetchPlaylistData(playlistId) {
        let lastError = null;
        const maxRetries = this.instances.length;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const currentInstance = this.instances[this.currentInstanceIndex];
            const apiUrl = `https://${currentInstance}/api/v1/playlists/${playlistId}`;

            try {
                this.showToast(`Trying ${currentInstance}...`, 'info');

                const response = await this.fetchWithTimeout(apiUrl);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                if (data && data.videos && data.videos.length > 0) {
                    this.showToast(`Successfully loaded playlist from ${currentInstance}`, 'success');
                    return { data, instance: currentInstance };
                } else {
                    throw new Error('No videos found in playlist');
                }

            } catch (error) {
                console.error(`Failed to fetch from ${currentInstance}:`, error);
                lastError = error;

                this.showToast(`Failed: ${currentInstance} - ${error.message}`, 'error');

                if (attempt < maxRetries - 1) {
                    await this.tryNextInstance();
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
                }
            }
        }

        throw lastError || new Error('All instances failed');
    }

    async fetchVideoData(videoId) {
        let lastError = null;
        const maxRetries = this.instances.length;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const currentInstance = this.instances[this.currentInstanceIndex];
            const apiUrl = `https://${currentInstance}/api/v1/videos/${videoId}`;

            try {
                this.showToast(`Trying ${currentInstance}...`, 'info');

                const response = await this.fetchWithTimeout(apiUrl);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                if (data && data.title) {
                    this.showToast(`Successfully loaded video from ${currentInstance}`, 'success');
                    return { data: [data], instance: currentInstance }; // Wrap single video in array format
                } else {
                    throw new Error('Invalid video data received');
                }

            } catch (error) {
                console.error(`Failed to fetch from ${currentInstance}:`, error);
                lastError = error;

                this.showToast(`Failed: ${currentInstance} - ${error.message}`, 'error');

                if (attempt < maxRetries - 1) {
                    await this.tryNextInstance();
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
                }
            }
        }

        throw lastError || new Error('All instances failed');
    }

    async handleLoad() {
        const urlInput = document.getElementById('urlInput');
        const loadButton = document.getElementById('loadButton');
        const sidebar = document.getElementById('sidebar');
        const playerContainer = document.getElementById('playerContainer');

        const url = urlInput.value.trim();

        if (!url) {
            alert('Please enter a YouTube URL');
            return;
        }

        const urlData = this.validateUrl(url);
        if (!urlData) {
            alert('Please enter a valid YouTube URL (youtube.com or youtu.be only)');
            return;
        }

        // Show loading state
        loadButton.disabled = true;
        loadButton.textContent = 'Loading...';
        sidebar.innerHTML = '<div class="loading">Loading playlist...</div>';
        playerContainer.innerHTML = '<div class="loading">Preparing player...</div>';

        try {
            let result;

            if (urlData.playlistId) {
                // Load playlist
                result = await this.fetchPlaylistData(urlData.playlistId);
                this.currentPlaylist = result.data.videos || result.data;
            } else if (urlData.videoId) {
                // Load single video
                result = await this.fetchVideoData(urlData.videoId);
                this.currentPlaylist = result.data;
            } else {
                throw new Error('No valid video or playlist ID found');
            }

            this.currentVideoIndex = 0;
            this.renderSidebar();
            this.playVideo(0, result.instance);

        } catch (error) {
            console.error('Load failed:', error);
            this.showToast(`Failed to load: ${error.message}`, 'error');
            sidebar.innerHTML = `<div class="error">Failed to load: ${error.message}</div>`;
            playerContainer.innerHTML = `<div class="error">Unable to load content</div>`;
        } finally {
            loadButton.disabled = false;
            loadButton.textContent = 'Load';
        }
    }

    renderSidebar() {
        const sidebar = document.getElementById('sidebar');

        if (!this.currentPlaylist || this.currentPlaylist.length === 0) {
            sidebar.innerHTML = '<div class="error">No videos available</div>';
            return;
        }

        const videosHtml = this.currentPlaylist.map((video, index) => {
            const title = video.title || 'Untitled Video';
            const duration = video.lengthSeconds ? this.formatDuration(video.lengthSeconds) : '';
            const author = video.author || video.authorId || '';
            const isActive = index === this.currentVideoIndex ? 'active' : '';

            return `
                <div class="video-item ${isActive}" onclick="embedder.playVideo(${index})">
                    <div class="video-title">${this.escapeHtml(title)}</div>
                    ${author ? `<div class="video-author">${this.escapeHtml(author)}</div>` : ''}
                    ${duration ? `<div class="video-duration">${duration}</div>` : ''}
                </div>
            `;
        }).join('');

        sidebar.innerHTML = videosHtml;
    }

    playVideo(index, forceInstance = null) {
        if (!this.currentPlaylist || index >= this.currentPlaylist.length) {
            console.error('Invalid video index:', index);
            return;
        }

        this.currentVideoIndex = index;
        const video = this.currentPlaylist[index];
        const videoId = video.videoId || video.id;

        if (!videoId) {
            console.error('No video ID found for video:', video);
            return;
        }

        // Use the working instance from the load operation, or current instance
        const instance = forceInstance || this.instances[this.currentInstanceIndex];
        const embedUrl = `https://${instance}/embed/${videoId}?autoplay=1`;

        const playerContainer = document.getElementById('playerContainer');
        playerContainer.innerHTML = `
            <iframe 
                src="${embedUrl}" 
                frameborder="0" 
                allowfullscreen
                style="width: 100%; height: 100%;"
                allow="autoplay; encrypted-media">
            </iframe>
        `;

        // Update active video in sidebar
        this.renderSidebar();

        this.showToast(`Playing: ${video.title}`, 'success');
    }

    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the application
let embedder;
document.addEventListener('DOMContentLoaded', () => {
    embedder = new InvidiousPlaylistEmbedder();
});
