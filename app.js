// Invidious Playlist Embedder - Enhanced JavaScript (Fixed)
class InvidiousEmbedder {
    constructor() {
        // Invidious instances in priority order
        this.instances = [
            "yewtu.be",
            "inv.nadeko.net", 
            "invidious.flokinet.to",
            "invidious.privacydev.net",
            "iv.melmac.space",
            "inv.tux.pizza",
            "invidious.protokolla.fi",
            "invidious.private.coffee",
            "yt.drgnz.club"
        ];
        
        this.currentInstanceIndex = 0;
        this.currentPlaylistData = null;
        this.currentVideoIndex = 0;
        
        this.initializeElements();
        this.attachEventListeners();
        this.updateInstanceStatus();
    }
    
    initializeElements() {
        // Get DOM elements
        this.urlInput = document.getElementById('urlInput');
        this.loadBtn = document.getElementById('loadBtn');
        this.statusMessage = document.getElementById('statusMessage');
        this.mainContent = document.getElementById('mainContent');
        this.videoPlayer = document.getElementById('videoPlayer');
        this.videoOverlay = document.getElementById('videoOverlay');
        this.videoInfo = document.getElementById('videoInfo');
        this.playlistContainer = document.getElementById('playlistContainer');
        this.playlistTitle = document.getElementById('playlistTitle');
        this.playlistCount = document.getElementById('playlistCount');
        this.currentInstanceSpan = document.getElementById('currentInstance');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.toastContainer = document.getElementById('toastContainer');
    }
    
    attachEventListeners() {
        // Load button click
        this.loadBtn.addEventListener('click', () => this.handleLoad());
        
        // Enter key in input
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleLoad();
            }
        });
        
        // Real-time validation with debouncing
        let validationTimeout;
        this.urlInput.addEventListener('input', () => {
            clearTimeout(validationTimeout);
            validationTimeout = setTimeout(() => {
                this.validateInput();
            }, 300);
        });
        
        // Input focus animations
        this.urlInput.addEventListener('focus', () => {
            this.urlInput.parentElement.classList.add('focused');
        });
        
        this.urlInput.addEventListener('blur', () => {
            this.urlInput.parentElement.classList.remove('focused');
        });
    }
    
    validateInput() {
        const url = this.urlInput.value.trim();
        
        if (!url) {
            this.clearStatusMessage();
            return false;
        }
        
        const isValid = this.isValidYouTubeUrl(url);
        
        if (!isValid) {
            this.showStatusMessage('Invalid YouTube URL format', 'error');
            return false;
        } else {
            this.showStatusMessage('Valid YouTube URL detected', 'success');
            return true;
        }
    }
    
    isValidYouTubeUrl(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            
            // Check if hostname ends with youtube.com or is exactly youtu.be
            return hostname.endsWith('youtube.com') || hostname === 'youtu.be';
        } catch {
            return false;
        }
    }
    
    extractIds(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            
            if (hostname === 'youtu.be') {
                // Short URL format: https://youtu.be/VIDEO_ID
                const videoId = urlObj.pathname.slice(1);
                return { videoId, playlistId: null };
            } else if (hostname.endsWith('youtube.com')) {
                const params = urlObj.searchParams;
                const videoId = params.get('v');
                const playlistId = params.get('list');
                
                return { videoId, playlistId };
            }
            
            return { videoId: null, playlistId: null };
        } catch {
            return { videoId: null, playlistId: null };
        }
    }
    
    async handleLoad() {
        const url = this.urlInput.value.trim();
        
        if (!url) {
            this.showToast('Please enter a YouTube URL', 'warning');
            this.urlInput.focus();
            return;
        }
        
        if (!this.isValidYouTubeUrl(url)) {
            this.showToast('Please enter a valid YouTube URL', 'error');
            this.urlInput.focus();
            return;
        }
        
        const { videoId, playlistId } = this.extractIds(url);
        
        if (!videoId && !playlistId) {
            this.showToast('Could not extract video or playlist ID from URL', 'error');
            return;
        }
        
        this.setLoading(true);
        this.clearStatusMessage();
        
        try {
            if (playlistId) {
                await this.loadPlaylist(playlistId);
            } else if (videoId) {
                await this.loadSingleVideo(videoId);
            }
        } catch (error) {
            console.error('Error loading content:', error);
            this.showToast('Failed to load content. Trying another instance...', 'error');
        } finally {
            this.setLoading(false);
        }
    }
    
    async loadPlaylist(playlistId) {
        let lastError = null;
        let successfulLoad = false;
        
        // Try each instance until one works
        for (let i = 0; i < this.instances.length; i++) {
            const instanceIndex = (this.currentInstanceIndex + i) % this.instances.length;
            const instance = this.instances[instanceIndex];
            
            try {
                this.updateInstanceStatus(instance, 'connecting');
                this.showStatusMessage(`Trying ${instance}...`, 'info');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                
                const response = await fetch(`https://${instance}/api/v1/playlists/${playlistId}`, {
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json',
                    }
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data || !data.videos || data.videos.length === 0) {
                    throw new Error('Empty or invalid playlist data');
                }
                
                // Success! Update current instance and load content
                this.currentInstanceIndex = instanceIndex;
                this.currentPlaylistData = data;
                this.updateInstanceStatus(instance, 'connected');
                
                this.displayPlaylist(data);
                this.showToast(`Successfully loaded playlist: ${data.title}`, 'success');
                this.showStatusMessage(`Loaded ${data.videos.length} videos from playlist`, 'success');
                
                successfulLoad = true;
                return;
                
            } catch (error) {
                console.warn(`Failed to load from ${instance}:`, error);
                lastError = error;
                this.updateInstanceStatus(instance, 'error');
                
                // Small delay before trying next instance
                if (i < this.instances.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        // All instances failed
        if (!successfulLoad) {
            this.showToast('All Invidious instances failed. Please try again later.', 'error');
            this.showStatusMessage('Failed to load from all instances', 'error');
            throw lastError || new Error('All instances failed');
        }
    }
    
    async loadSingleVideo(videoId) {
        let lastError = null;
        let successfulLoad = false;
        
        // Try each instance until one works
        for (let i = 0; i < this.instances.length; i++) {
            const instanceIndex = (this.currentInstanceIndex + i) % this.instances.length;
            const instance = this.instances[instanceIndex];
            
            try {
                this.updateInstanceStatus(instance, 'connecting');
                this.showStatusMessage(`Trying ${instance}...`, 'info');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                
                const response = await fetch(`https://${instance}/api/v1/videos/${videoId}`, {
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json',
                    }
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data || !data.title) {
                    throw new Error('Invalid video data');
                }
                
                // Success! Update current instance and load content
                this.currentInstanceIndex = instanceIndex;
                this.updateInstanceStatus(instance, 'connected');
                
                // Create single video "playlist"
                const singleVideoPlaylist = {
                    title: data.title,
                    videos: [data]
                };
                
                this.currentPlaylistData = singleVideoPlaylist;
                this.displayPlaylist(singleVideoPlaylist);
                this.showToast(`Successfully loaded video: ${data.title}`, 'success');
                this.showStatusMessage('Video loaded successfully', 'success');
                
                successfulLoad = true;
                return;
                
            } catch (error) {
                console.warn(`Failed to load from ${instance}:`, error);
                lastError = error;
                this.updateInstanceStatus(instance, 'error');
                
                // Small delay before trying next instance
                if (i < this.instances.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        // All instances failed
        if (!successfulLoad) {
            this.showToast('All Invidious instances failed. Please try again later.', 'error');
            this.showStatusMessage('Failed to load from all instances', 'error');
            throw lastError || new Error('All instances failed');
        }
    }
    
    displayPlaylist(playlistData) {
        // Show main content with animation
        setTimeout(() => {
            this.mainContent.classList.add('visible');
        }, 100);
        
        // Update playlist header
        this.playlistTitle.textContent = playlistData.title || 'Playlist';
        this.playlistCount.textContent = `${playlistData.videos.length} video${playlistData.videos.length !== 1 ? 's' : ''}`;
        
        // Clear and populate playlist
        this.playlistContainer.innerHTML = '';
        
        playlistData.videos.forEach((video, index) => {
            const item = this.createPlaylistItem(video, index);
            this.playlistContainer.appendChild(item);
        });
        
        // Play first video
        setTimeout(() => {
            this.playVideo(0);
        }, 500);
    }
    
    createPlaylistItem(video, index) {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.setAttribute('data-index', index);
        
        // Format duration
        const duration = video.lengthSeconds ? this.formatDuration(video.lengthSeconds) : 'N/A';
        
        item.innerHTML = `
            <div class="playlist-item-thumbnail">
                📹
            </div>
            <div class="playlist-item-info">
                <div class="playlist-item-title">${this.escapeHtml(video.title || 'Untitled Video')}</div>
                <div class="playlist-item-duration">${duration}</div>
            </div>
        `;
        
        // Add click handler
        item.addEventListener('click', () => {
            this.playVideo(index);
        });
        
        // Add keyboard support
        item.setAttribute('tabindex', '0');
        item.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.playVideo(index);
            }
        });
        
        return item;
    }
    
    playVideo(index) {
        if (!this.currentPlaylistData || !this.currentPlaylistData.videos[index]) {
            return;
        }
        
        const video = this.currentPlaylistData.videos[index];
        const instance = this.instances[this.currentInstanceIndex];
        
        // Update current video index
        this.currentVideoIndex = index;
        
        // Update active playlist item
        document.querySelectorAll('.playlist-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        
        // Update video player
        const embedUrl = `https://${instance}/embed/${video.videoId}?autoplay=1&quality=hd720`;
        this.videoPlayer.src = embedUrl;
        
        // Hide overlay with animation
        setTimeout(() => {
            this.videoOverlay.classList.add('hidden');
        }, 100);
        
        // Update video info
        this.updateVideoInfo(video);
        
        // Show video info with animation
        setTimeout(() => {
            this.videoInfo.classList.add('visible');
        }, 300);
        
        this.showToast(`Now playing: ${video.title}`, 'info');
    }
    
    updateVideoInfo(video) {
        const titleElement = this.videoInfo.querySelector('.video-title');
        const descriptionElement = this.videoInfo.querySelector('.video-description');
        
        titleElement.textContent = video.title || 'Untitled Video';
        
        // Create description with metadata
        const metadata = [];
        if (video.author) metadata.push(`By ${video.author}`);
        if (video.viewCount) metadata.push(`${this.formatNumber(video.viewCount)} views`);
        if (video.published) metadata.push(`Published ${new Date(video.published * 1000).toLocaleDateString()}`);
        
        let description = metadata.join(' • ');
        if (video.description) {
            description += `\n\n${video.description.substring(0, 200)}${video.description.length > 200 ? '...' : ''}`;
        }
        
        descriptionElement.textContent = description || 'No description available';
    }
    
    updateInstanceStatus(instance = null, status = 'disconnected') {
        if (instance) {
            this.currentInstanceSpan.textContent = instance;
        } else {
            this.currentInstanceSpan.textContent = 'Not connected';
        }
        
        // Update indicator
        this.statusIndicator.className = 'status-indicator';
        if (status === 'connected') {
            this.statusIndicator.classList.add('connected');
        }
    }
    
    setLoading(loading) {
        this.loadBtn.classList.toggle('loading', loading);
        this.loadingOverlay.classList.toggle('visible', loading);
        this.urlInput.disabled = loading;
        
        if (loading) {
            this.loadBtn.setAttribute('aria-label', 'Loading...');
        } else {
            this.loadBtn.setAttribute('aria-label', 'Load video or playlist');
        }
    }
    
    showStatusMessage(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        
        // Auto-clear success messages after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                this.clearStatusMessage();
            }, 3000);
        }
    }
    
    clearStatusMessage() {
        this.statusMessage.textContent = '';
        this.statusMessage.className = 'status-message';
    }
    
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        this.toastContainer.appendChild(toast);
        
        // Auto remove after 4 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'toastSlideIn 0.3s ease reverse';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 4000);
    }
    
    // Utility functions
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
    
    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        } else {
            return num.toString();
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Enhanced UI Interactions
class UIEnhancements {
    constructor() {
        this.initializeAnimations();
        this.initializeKeyboardNavigation();
    }
    
    initializeAnimations() {
        // Add entrance animations to elements as they become visible
        const animateElements = document.querySelectorAll('.card, .playlist-item');
        animateElements.forEach((el, index) => {
            el.style.animationDelay = `${index * 0.1}s`;
        });
    }
    
    initializeKeyboardNavigation() {
        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape key to clear input or close modals
            if (e.key === 'Escape') {
                const input = document.getElementById('urlInput');
                const loadingOverlay = document.getElementById('loadingOverlay');
                
                if (loadingOverlay.classList.contains('visible')) {
                    // Don't close loading overlay with Escape
                    return;
                }
                
                if (document.activeElement === input) {
                    input.blur();
                } else {
                    input.focus();
                }
            }
            
            // Ctrl/Cmd + Enter to load
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const loadBtn = document.getElementById('loadBtn');
                if (!loadBtn.classList.contains('loading')) {
                    loadBtn.click();
                }
                e.preventDefault();
            }
        });
    }
    
    // Add ripple effect to buttons
    addRippleEffect(button) {
        button.addEventListener('click', function(e) {
            const ripple = document.createElement('span');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            
            ripple.style.cssText = `
                position: absolute;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.3);
                pointer-events: none;
                width: ${size}px;
                height: ${size}px;
                left: ${x}px;
                top: ${y}px;
                transform: scale(0);
                animation: ripple 0.6s linear;
            `;
            
            const style = document.createElement('style');
            if (!document.head.querySelector('#ripple-styles')) {
                style.id = 'ripple-styles';
                style.textContent = `
                    @keyframes ripple {
                        to {
                            transform: scale(4);
                            opacity: 0;
                        }
                    }
                `;
                document.head.appendChild(style);
            }
            
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            
            setTimeout(() => {
                if (ripple.parentNode) {
                    ripple.remove();
                }
            }, 600);
        });
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎥 Initializing Invidious Playlist Embedder...');
    
    // Initialize main application
    const embedder = new InvidiousEmbedder();
    
    // Initialize UI enhancements
    const uiEnhancements = new UIEnhancements();
    
    // Add ripple effects to buttons
    document.querySelectorAll('.btn').forEach(btn => {
        uiEnhancements.addRippleEffect(btn);
    });
    
    // Add accessibility improvements
    const urlInput = document.getElementById('urlInput');
    const loadBtn = document.getElementById('loadBtn');
    
    // Improve focus management
    urlInput.addEventListener('focus', () => {
        urlInput.setAttribute('aria-describedby', 'statusMessage');
    });
    
    // Add loading states to button
    loadBtn.setAttribute('aria-label', 'Load video or playlist');
    
    // Console welcome message
    console.log('%c🎥 Invidious Playlist Embedder', 'color: #6366f1; font-size: 20px; font-weight: bold;');
    console.log('%cEnhanced version with modern UI/UX', 'color: #8b5cf6; font-size: 14px;');
    console.log('%cKeyboard shortcuts: Ctrl/Cmd + Enter to load, Escape to focus/blur input', 'color: #06b6d4; font-size: 12px;');
    
    // Make embedder available globally for debugging
    window.embedder = embedder;
});