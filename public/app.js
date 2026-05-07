const DEFAULT_API_BASE = 'https://musica-pi.your-domain.com';
let API_BASE = DEFAULT_API_BASE;
let currentUser = null;
let offlineMode = false;
let currentTrackMeta = null;
let currentPlaylistId = null;
let currentLoopTrackIds = [];
let currentLibraryPage = 1;
const LIBRARY_PAGE_SIZE = 10;

let audioCtx = null;
let analyser = null;
let audioSource = null;

function setStatus(message) {
    document.getElementById('playerStatus').textContent = message;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function updateNowPlaying(meta = {}) {
    currentTrackMeta = meta;
    document.getElementById('nowPlayingTitle').textContent = meta.title || 'No track selected';
    document.getElementById('nowPlayingSubtitle').textContent = meta.subtitle || 'Search shared music or play from your library.';
    
    // Sync with hardware media controls (headsets/lock screen)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: meta.title || 'Musica',
            artist: meta.subtitle || 'Musica AI',
            artwork: [{ src: meta.coverUrl || '/icon.png', sizes: '512x512', type: 'image/png' }]
        });
    }

    applyCoverToElement(document.getElementById('playerCover'), meta.title, meta.coverUrl);
    setStatus(meta.status || 'Ready to play');
}

function getCoverLetter(title) {
    if (!title) return 'M';
    return title.trim().charAt(0).toUpperCase();
}

function getCoverColors(title) {
    const base = title?.trim().toUpperCase().charCodeAt(0) || 65;
    const hue = base * 19 % 360;
    return [`hsl(${hue}, 78%, 46%)`, `hsl(${(hue + 40) % 360}, 74%, 46%)`];
}

function applyCoverToElement(element, title, coverUrl) {
    if (!element) return;
    element.style.backgroundImage = '';
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.style.color = '#fff';
    element.style.display = 'grid';
    element.style.placeItems = 'center';
    element.style.fontWeight = '700';
    element.style.letterSpacing = '0.08em';
    element.style.textTransform = 'uppercase';
    if (coverUrl) {
        element.textContent = '';
        element.style.backgroundImage = `url(${coverUrl})`;
    } else {
        const [start, end] = getCoverColors(title);
        element.textContent = getCoverLetter(title);
        element.style.backgroundImage = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
    }
}

function makePlaylistTheme(name) {
    const [colorA, colorB] = getCoverColors(name || 'playlist');
    return { background: `linear-gradient(135deg, ${colorA} 0%, ${colorB} 100%)` };
}

function renderTrackItem(mp3, options = {}) {
    const { showDelete = false, showImport = false, showQueue = true, showPlaylist = true, extraSubtitle = '' } = options;
    const li = document.createElement('li');
    li.className = 'track-item compact';

    const trackTitle = mp3.fileName || mp3.file_name || mp3.title || `Track ${mp3.id}`;
    const trackAuthor = mp3.uploaderName || mp3.uploaderEmail || mp3.artist || '';
    const trackSubtitle = trackAuthor ? `By ${trackAuthor}` : extraSubtitle || `Track ${mp3.id}`;

    li.onclick = event => {
        if (event.target.closest('button')) return;
        playMp3(mp3.id, { metadata: mp3 });
    };

    const thumb = document.createElement('div');
    thumb.className = 'track-thumb';
    applyCoverToElement(thumb, trackTitle, mp3.coverUrl ? resolveApiUrl(mp3.coverUrl) : null);

    const meta = document.createElement('div');
    meta.className = 'track-meta';
    const title = document.createElement('span');
    title.textContent = trackTitle;
    const subtitle = document.createElement('small');
    subtitle.textContent = trackSubtitle;
    meta.appendChild(title);
    meta.appendChild(subtitle);

    const actions = document.createElement('div');
    actions.className = 'track-actions';

    const playButton = document.createElement('button');
    playButton.textContent = '▶️';
    playButton.title = 'Play';
    playButton.onclick = (event) => {
        event.stopPropagation();
        playMp3(mp3.id, { metadata: mp3 });
    };
    actions.appendChild(playButton);

    if (showQueue) {
        const queueButton = document.createElement('button');
        queueButton.textContent = '➕';
        queueButton.title = 'Add to queue';
        queueButton.className = 'queue-button';
        queueButton.onclick = event => {
            event.stopPropagation();
            addToQueue(mp3.id);
        };
        actions.appendChild(queueButton);
    }

    if (showPlaylist) {
        const playlistButton = document.createElement('button');
        playlistButton.textContent = '📁';
        playlistButton.title = 'Add to playlist';
        playlistButton.className = 'secondary';
        playlistButton.onclick = event => {
            event.stopPropagation();
            addTrackToPlaylist(mp3.id);
        };
        actions.appendChild(playlistButton);
    }

    if (showImport && !mp3.owned) {
        const importButton = document.createElement('button');
        importButton.textContent = '📥';
        importButton.title = 'Import';
        importButton.className = 'secondary';
        importButton.onclick = event => {
            event.stopPropagation();
            importTrack(mp3.id);
        };
        actions.appendChild(importButton);
    }

    if (showDelete) {
        const deleteButton = document.createElement('button');
        deleteButton.textContent = '🗑️';
        deleteButton.title = 'Delete';
        deleteButton.className = 'delete-button';
        deleteButton.onclick = event => {
            event.stopPropagation();
            deleteMp3(mp3.id);
        };
        actions.appendChild(deleteButton);
    }

    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(actions);
    return li;
}

function updateSeekBar() {
    const player = document.getElementById('audioPlayer');
    const slider = document.getElementById('seekBar');
    if (!player || !slider) return;
    slider.max = Math.floor(player.duration || 0);
    slider.value = Math.floor(player.currentTime || 0);
    document.getElementById('currentTime').textContent = formatDuration(player.currentTime || 0);
    document.getElementById('durationTime').textContent = formatDuration(player.duration || 0);
}

function setPlayButtonState(isPlaying) {
    const button = document.getElementById('playPauseBtn');
    const cover = document.getElementById('playerCover');
    if (button) {
        button.textContent = isPlaying ? '⏸️ Pause' : '▶️ Play';
    }
    if (cover) {
        cover.classList.toggle('playing', isPlaying);
    }
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
}

function showTab(name) {
    const tabs = ['library', 'search', 'playlist', 'tracks', 'queue'];
    tabs.forEach(tab => {
        const panel = document.getElementById(`${tab}Tab`); // Ensure 'settings' tab is included
        const button = document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Btn`);
        if (panel) panel.classList.toggle('active', tab === name);
        if (button) button.classList.toggle('active', tab === name);
    });
    if (name === 'search') {
        // Search tab: show search box for filtering
        searchAllTracks();
    }
    if (name === 'tracks') {
        // Tracks tab: show all shared tracks
        loadAllTracks();
    }
    if (name === 'playlist') {
        getPlaylists();
    }
    if (name === 'queue') {
        getQueue();
    }
}

function initVisualizer() {
    const player = document.getElementById('audioPlayer');
    const canvas = document.getElementById('visualizerCanvas');
    if (!player || !canvas || audioCtx) return;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        audioSource = audioCtx.createMediaElementSource(player);
        audioSource.connect(analyser);
        analyser.connect(audioCtx.destination);

        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const ctx = canvas.getContext('2d');

        function draw() {
            requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            if (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight) {
                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetHeight;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const barWidth = (canvas.width / bufferLength);
            
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
                // Spotify green theme with dynamic opacity
                ctx.fillStyle = `rgba(29, 185, 84, ${0.05 + (dataArray[i] / 255) * 0.4})`;
                ctx.fillRect(i * barWidth, canvas.height - barHeight, barWidth - 2, barHeight);
            }
        }
        draw();
    } catch (e) { console.warn('Visualizer setup failed', e); }
}

function togglePlayPause() {
    const player = document.getElementById('audioPlayer');
    // Ensure AudioContext is resumed before playing, and handle potential errors
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(err => console.error('Failed to resume AudioContext:', err));
    }
    if (player.paused) {
        player.play().then(() => {
            setPlayButtonState(true);
            // After playing, ensure the queue is updated if it's a single track play
            // This might be redundant if playMp3 already calls getQueue, but safe
            getQueue(); 
        }).catch(err => {
            console.error('Error during player.play() in togglePlayPause:', err); // More specific error logging
            setStatus(`Playback failed: ${err.message}`);
        });
    } else {
        player.pause();
        setPlayButtonState(false);
    }
}

function getApiBase() {
    return API_BASE || DEFAULT_API_BASE;
}

function resolveApiUrl(path) {
    const base = getApiBase();
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

function fetchApi(url, options = {}) {
    const token = getAuthToken();
    const headers = options.headers || {};
    
    // Add token to Authorization header if available
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return fetch(url, { 
        credentials: 'include', 
        ...options,
        headers
    });
}

async function loadAudioSource(url) {
    const player = document.getElementById('audioPlayer');
    if (!player) {
        throw new Error('Audio player not found');
    }
    if (player.dataset.objectUrl) {
        URL.revokeObjectURL(player.dataset.objectUrl);
        delete player.dataset.objectUrl;
    }
    
    // Optimized for speed: use direct streaming instead of waiting for a full blob fetch.
    // This allows the browser to buffer and start playing almost immediately.
    const token = getAuthToken();
    const authenticatedUrl = token ? `${url}${url.includes('?') ? '&' : '?'}token=${token}` : url;
    
    player.src = ''; // Clear existing source
    player.pause();
    player.removeAttribute('src'); // Force clean state
    player.src = authenticatedUrl;
}

function storeOfflineData(key, data) {
    try {
        // Limit stored data size to prevent memory issues
        const dataStr = JSON.stringify(data);
        if (dataStr.length > 1024 * 1024) { // 1MB limit
            console.warn('Data too large to cache:', key, dataStr.length, 'bytes');
            return;
        }
        localStorage.setItem(key, dataStr);
    } catch (err) {
        console.warn('Failed to store offline data', err);
    }
}

function loadOfflineData(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('Failed to load offline data', err);
        return null;
    }
}

function saveOfflineUser(user) {
    if (user) {
        // Ensure displayName is saved for offline mode
        storeOfflineData('musica-offline-user', {
            id: user.id,
            email: user.email,
            // Use displayName if available, otherwise fallback to email part
            displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Guest'),
            hasPicture: !!user.hasPicture
        });
    } else {
        // If user is null, clear the offline user data
        storeOfflineData('musica-offline-user', user);
    }
}

function clearOfflineUser() {
    localStorage.removeItem('musica-offline-user');
}

function saveAuthToken(token) {
    if (token) {
        localStorage.setItem('musica-auth-token', token);
    }
}

function getAuthToken() {
    return localStorage.getItem('musica-auth-token');
}

function clearAuthToken() {
    localStorage.removeItem('musica-auth-token');
}

async function parseJsonOrText(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function toggleAuthMode(e) {
    e.preventDefault();
    document.getElementById('loginForm').style.display = document.getElementById('loginForm').style.display === 'none' ? 'block' : 'none';
    document.getElementById('signupForm').style.display = document.getElementById('signupForm').style.display === 'none' ? 'block' : 'none';
}

function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        setStatus('Please enter email and password'); // Changed from alert
        return;
    }

    fetchApi(resolveApiUrl('/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || 'Login failed');
        }
        return body;
    })
    .then(user => {
        currentUser = user;
        offlineMode = false;
        saveOfflineUser(user);
        // Save the authentication token if provided
        if (user.token) {
            saveAuthToken(user.token);
            console.log('[LOGIN] Auth method:', user.authMethod, 'Token:', user.token ? 'present' : 'missing');
        }
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        showApp();
        getMp3Files();
        getQueue();
        getPlaylists();
        searchAllTracks();
    })
    .catch(error => {
        setStatus(`Login error: ${error.message}`); // Changed from alert
    });
}

function handleSignup() {
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const displayName = document.getElementById('signupName').value.trim() || email.split('@')[0];

    if (!email || !password) {
        setStatus('Please enter email and password'); // Changed from alert
        return;
    }

    fetchApi(resolveApiUrl('/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName })
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || 'Signup failed');
        }
        return body;
    })
    .then(user => {
        currentUser = user;
        offlineMode = false;
        saveOfflineUser(user);
        // Save the authentication token if provided
        if (user.token) {
            saveAuthToken(user.token);
            console.log('[SIGNUP] Auth method:', user.authMethod, 'Token:', user.token ? 'present' : 'missing');
        }
        document.getElementById('signupEmail').value = '';
        document.getElementById('signupPassword').value = '';
        document.getElementById('signupName').value = '';
        showApp();
        getMp3Files();
        getQueue();
        getPlaylists();
        searchAllTracks();
    })
    .catch(error => {
        setStatus(`Signup error: ${error.message}`); // Changed from alert
    });
}

function handleLogout() {
    fetchApi(resolveApiUrl('/logout'), { method: 'POST' })
    .then(() => {
        currentUser = null;
        offlineMode = false;
        clearOfflineUser();
        clearAuthToken();
        document.getElementById('musicFile').value = '';
        showAuth();
    })
    .catch(error => {
        console.error('Logout error:', error);
        currentUser = null;
        clearAuthToken();
        showAuth();
    });
}

function showAuth() {
    document.getElementById('authPanel').style.display = 'flex';
    document.getElementById('mainContent').style.display = 'none';
}

function showApp() {
    document.getElementById('authPanel').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
    
    const avatarImg = document.getElementById('headerAvatar');
    const nameSpan = document.getElementById('headerUserName');

    if (currentUser && nameSpan && avatarImg) {
        nameSpan.textContent = currentUser.displayName || currentUser.email;
        const token = getAuthToken();
        const avatarUrl = resolveApiUrl('/user/avatar') + '?t=' + Date.now() + (token ? '&token=' + token : '');
        
        avatarImg.src = avatarUrl;
        avatarImg.style.display = 'block';
        // Hide if no image found (404)
        avatarImg.onerror = () => { avatarImg.style.display = 'none'; };
    }
}

function checkAuth() {
    loadBackendUrl(); // Load stored API_BASE before making any network requests
    fetchApi(resolveApiUrl('/auth/user'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response); // AWAIT here
        if (!response.ok || !body || !body.authenticated) {
            const cachedUser = loadOfflineData('musica-offline-user');
            if (cachedUser) {
                currentUser = cachedUser;
                offlineMode = true;
                showApp();
                getMp3Files();
                // getQueue() and getPlaylists() are called by showApp indirectly or will be called by other tab switches
                getQueue();
                getPlaylists();
                setStatus('Offline mode: showing cached content');
                return;
            }
            showAuth();
            return;
        }
        currentUser = body.user;
        offlineMode = false;
        saveOfflineUser(body.user);
        // showApp() will update the header with currentUser.displayName
        showApp();
        getMp3Files();
        getQueue();
        getPlaylists();
        searchAllTracks();
    })
    .catch(() => {
        const cachedUser = loadOfflineData('musica-offline-user');
        if (cachedUser) {
            currentUser = cachedUser;
            offlineMode = true;
            showApp();
            // getQueue() and getPlaylists() are called by showApp indirectly or will be called by other tab switches
            getMp3Files();
            getQueue();
            getPlaylists();
            setStatus('Offline mode: showing cached content');
            return;
        }
        showAuth();
    });
}

function saveBackendUrl() {
    const url = document.getElementById('backendUrl').value.trim();
    API_BASE = url;
    localStorage.setItem('musicify-backend-url', url);
    setStatus(url ? 'Backend set to ' + url : 'Using local backend');
}

function loadBackendUrl() {
    const url = localStorage.getItem('musicify-backend-url');
    if (url) {
        API_BASE = url;
        document.getElementById('backendUrl').value = url;
        setStatus('Backend set to ' + url);
    } else {
        API_BASE = DEFAULT_API_BASE;
        document.getElementById('backendUrl').value = DEFAULT_API_BASE;
        setStatus('Using Render backend: ' + DEFAULT_API_BASE);
    }
}

async function uploadMusic() {
    const fileInput = document.getElementById('musicFile');
    const files = Array.from(fileInput.files || []);
    const audioFiles = files.filter(file => file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.mp3'));

    if (audioFiles.length === 0) {
        setStatus('No valid audio files found.'); // Changed from alert
        return;
    }

    const CHUNK_SIZE = 3; // very safe for Render free tier
    for (let i = 0; i < audioFiles.length; i += CHUNK_SIZE) {
        const chunk = audioFiles.slice(i, i + CHUNK_SIZE);
        const formData = new FormData();
        chunk.forEach(file => formData.append('music', file));

        try {
const response = await fetchApi(resolveApiUrl('/upload'), {
                method: 'POST',
                body: formData,
                headers: { 'Accept': 'application/json' }
            });

            const body = await parseJsonOrText(response);
            if (!response.ok) {
                const message = body && body.error ? body.error : body;
                throw new Error(message || 'Upload failed');
            }

            setStatus(`Uploaded batch ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} files)`);
        } catch (error) {
            setStatus(`Error uploading batch ${Math.floor(i / CHUNK_SIZE) + 1}: ${error.message}`);
            return;
        }
    }

    fileInput.value = '';
    getMp3Files();
    getQueue();
    setStatus('All files uploaded safely!');
}
async function safeFetch(url, options = {}) {
    const { cacheKey } = options;
    try {
        const response = await fetchApi(url, options);
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Server returned ${response.status}: ${body}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json();
            if (cacheKey) {
                storeOfflineData(cacheKey, data);
            }
            return data;
        } else {
            const text = await response.text();
            if (cacheKey) {
                storeOfflineData(cacheKey, text);
            }
            return text;
        }
    } catch (err) {
        console.error(`Error fetching ${url}:`, err);
        if (cacheKey) {
            const cached = loadOfflineData(cacheKey);
            if (cached !== null) {
                setStatus(`Offline mode: showing cached data`);
                return cached;
            }
        }
        setStatus(`Server error: ${err.message}`);
        return null;
    }
}

async function getMp3Files(page = currentLibraryPage, perPage = LIBRARY_PAGE_SIZE) { // Made async
    currentLibraryPage = Math.max(1, page);
    try {
        const allFiles = await safeFetch(resolveApiUrl('/mp3_files'), { cacheKey: 'musica-offline-tracks' });
        if (!allFiles || !Array.isArray(allFiles)) throw new Error('Invalid response format');

        const totalItems = allFiles.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
        if (currentLibraryPage > totalPages) {
            currentLibraryPage = totalPages;
        }

        const start = (currentLibraryPage - 1) * perPage;
        const end = start + perPage;
        const paginatedFiles = allFiles.slice(start, end);

        const list = document.getElementById('mp3List');
        list.innerHTML = '';

        if (paginatedFiles.length === 0) {
            list.innerHTML = '<li style="padding: 20px; text-align: center; color: #999;">No tracks yet</li>';
            const pagination = document.getElementById('libraryPagination');
            if (pagination) {
                pagination.innerHTML = '';
            }
            return;
        }

        paginatedFiles.forEach(mp3 => {
            const li = renderTrackItem(mp3, {
                showDelete: true,
                showImport: false,
                showQueue: true,
                showPlaylist: true,
                extraSubtitle: 'Your library'
            });
            list.appendChild(li);
        });

        // Optional pagination buttons
        const pagination = document.getElementById('libraryPagination');
        if (pagination) {
            pagination.innerHTML = `
                <button ${currentLibraryPage === 1 ? 'disabled' : ''} onclick="prevLibraryPage()">Prev</button>
                <span>Page ${currentLibraryPage} / ${totalPages}</span>
                <button ${currentLibraryPage === totalPages ? 'disabled' : ''} onclick="nextLibraryPage()">Next</button>
            `;
        }

        setStatus(`Loaded ${paginatedFiles.length} tracks (${totalItems} total)`);
    } catch (error) {
        console.error('getMp3Files error:', error);
        const list = document.getElementById('mp3List');
        list.innerHTML = `<li style="padding: 20px; text-align: center; color: #ff6b6b;">${error.message}</li>`;
        const pagination = document.getElementById('libraryPagination');
        if (pagination) {
            pagination.innerHTML = '';
        }
        setStatus(`Load error: ${error.message}`);
    }
}

function prevLibraryPage() {
    if (currentLibraryPage <= 1) return;
    currentLibraryPage -= 1;
    getMp3Files();
}

function nextLibraryPage() {
    currentLibraryPage += 1;
    getMp3Files();
}

async function searchAllTracks(query) { // Made async
    if (!currentUser || offlineMode) {
        const list = document.getElementById('searchResults');
        if (list) {
            list.innerHTML = '<li style="padding: 18px; text-align: center; color: #999;">Sign in to search or go online to search shared tracks.</li>';
        }
        setStatus('Please sign in or reconnect to search shared music');
        return;
    }

    const searchValue = query !== undefined ? query : document.getElementById('searchInput').value.trim();
    
    // If no search query, show empty state with instructions
    if (!searchValue) {
        const list = document.getElementById('searchResults');
        if (list) {
            list.innerHTML = '<li style="padding: 18px; text-align: center; color: #999;">Enter a search term to find tracks, or go to the <strong>Tracks</strong> tab to browse all shared music.</li>';
        }
        setStatus('Enter a search term');
        return;
    }

    const cacheKey = `musica-offline-search-${searchValue}`;
    const url = resolveApiUrl(`/search?q=${encodeURIComponent(searchValue)}`);

    try {
        const data = await safeFetch(url, { cacheKey });
        if (!data || !Array.isArray(data)) throw new Error('Invalid search response');

        renderSearchResults(data);
        setStatus(`Found ${data.length} tracks`);
    } catch (error) {
        console.error('searchAllTracks error:', error);
        setStatus(`Search error: ${error.message}`);
        const list = document.getElementById('searchResults');
        if (list) {
            list.innerHTML = `<li style="padding: 18px; text-align: center; color: #ff6b6b;">${error.message}</li>`;
        }
    }
}

async function loadAllTracks() { // Made async
    if (!currentUser || offlineMode) {
        const list = document.getElementById('tracksResults');
        if (list) {
            list.innerHTML = '<li style="padding: 18px; text-align: center; color: #999;">Sign in to browse shared tracks.</li>';
        }
        setStatus('Please sign in to view shared tracks');
        return;
    }

    const url = resolveApiUrl('/search');
    setStatus('Loading shared tracks...');

    try {
        const data = await safeFetch(url, { cacheKey: 'musica-offline-alltracks' });
        if (!data || !Array.isArray(data)) throw new Error('Invalid tracks response');

        renderAllTracks(data);
        setStatus(`Loaded ${data.length} shared tracks`);
    } catch (error) {
        console.error('loadAllTracks error:', error);
        setStatus(`Failed to load tracks: ${error.message}`);
        const list = document.getElementById('tracksResults');
        if (list) {
            list.innerHTML = `<li style="padding: 18px; text-align: center; color: #ff6b6b;">${error.message}</li>`;
        }
    }
}

function renderAllTracks(data) {
    const list = document.getElementById('tracksResults');
    list.innerHTML = '';
    if (!Array.isArray(data) || data.length === 0) {
        list.innerHTML = '<li style="padding: 18px; text-align: center; color: #999;">No shared tracks found.</li>';
        return;
    }
    data.forEach(mp3 => {
        const li = renderTrackItem(mp3, {
            showDelete: false,
            showImport: !mp3.owned,
            showQueue: true,
            showPlaylist: true,
            extraSubtitle: mp3.owned ? 'Your library' : `Shared by ${mp3.uploaderName || mp3.uploaderEmail || 'Community'}`
        });
        list.appendChild(li);
    });
}

function renderSearchResults(data) {
    const list = document.getElementById('searchResults');
    list.innerHTML = '';
    if (!Array.isArray(data) || data.length === 0) {
        list.innerHTML = '<li style="padding: 18px; text-align: center; color: #999;">No tracks found in shared library.</li>';
        return;
    }
    data.forEach(mp3 => {
        const li = renderTrackItem(mp3, {
            showDelete: false,
            showImport: !mp3.owned,
            showQueue: true,
            showPlaylist: true,
            extraSubtitle: mp3.owned ? 'Your library' : `Shared by ${mp3.uploaderName || mp3.uploaderEmail || 'Community'}`
        });
        list.appendChild(li);
    });
}

async function getPlaylists() { // Made async
    safeFetch(resolveApiUrl('/playlists'), { cacheKey: 'musica-offline-playlists' })
    .then(data => {
        if (!Array.isArray(data)) {
            throw new Error('Invalid playlists response');
        }
        renderPlaylists(data);
    })
    .catch(error => {
        console.error('getPlaylists error:', error);
        setStatus(`Playlists error: ${error.message}`);
    });
}

function renderPlaylists(data) {
    const list = document.getElementById('playlistsList');
    list.innerHTML = '';
    if (!Array.isArray(data) || data.length === 0) {
        list.innerHTML = '<li style="padding: 15px; text-align: center; color: #999;">No playlists created yet.</li>';
        return;
    }
    data.forEach(playlist => {
        const li = document.createElement('li');
        li.className = 'playlist-item';
        const accent = document.createElement('div');
        accent.className = 'playlist-accent';
        Object.assign(accent.style, makePlaylistTheme(playlist.name));

        const meta = document.createElement('div');
        meta.className = 'playlist-meta';
        const title = document.createElement('span');
        title.textContent = playlist.name;
        const subtitle = document.createElement('small');
        subtitle.textContent = `${playlist.trackCount || 0} track${playlist.trackCount === 1 ? '' : 's'}`;
        meta.appendChild(title);
        meta.appendChild(subtitle);

        const openButton = document.createElement('button');
        openButton.className = 'secondary';
        openButton.textContent = 'Open';
        openButton.onclick = () => loadPlaylistDetails(playlist.id, playlist.name);

        li.appendChild(accent);
        li.appendChild(meta);
        li.appendChild(openButton);
        list.appendChild(li);
    });
}

function createPlaylist() {
    const name = document.getElementById('playlistName').value.trim();
    if (!name) {
        setStatus('Please enter a playlist name'); // Changed from alert
        return;
    }
    fetchApi(resolveApiUrl('/playlists'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Playlist creation failed');
        }
        return body;
    })
    .then(() => {
        document.getElementById('playlistName').value = '';
        setStatus(`Playlist created: ${name}`);
        getPlaylists();
    })
    .catch(error => {
        setStatus(`Playlist error: ${error.message}`);
    });
}

function addTrackToPlaylist(trackId) {
    if (!currentPlaylistId) {
        setStatus('Select a playlist before adding tracks'); // Changed from alert
        return;
    }
    fetchApi(resolveApiUrl(`/playlists/${currentPlaylistId}/tracks`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId })
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Unable to add track to playlist');
        }
        return body;
    })
    .then(() => {
        setStatus('Track added to playlist');
        loadPlaylistDetails(currentPlaylistId, document.getElementById('currentPlaylistName').textContent);
    })
    .catch(error => {
        setStatus(`Playlist update error: ${error.message}`);
    });
}

async function loadPlaylistDetails(id, name) { // Made async
    currentPlaylistId = id;
    document.getElementById('currentPlaylistName').textContent = name;
    safeFetch(resolveApiUrl(`/playlists/${id}`), { cacheKey: `musica-offline-playlist-${id}` })
    .then(data => {
        if (!data || !Array.isArray(data.tracks)) {
            throw new Error('Invalid playlist response');
        }
        renderPlaylistTracks(data.tracks);
    })
    .catch(error => {
        setStatus(`Playlist load error: ${error.message}`);
    });
}

function renderPlaylistTracks(tracks) {
    const list = document.getElementById('playlistTrackList');
    list.innerHTML = '';
    currentLoopTrackIds = Array.isArray(tracks) ? tracks.map(track => track.id) : [];
    if (!Array.isArray(tracks) || tracks.length === 0) {
        list.innerHTML = '<li style="padding: 16px; text-align: center; color: #999;">No songs in this playlist yet.</li>';
        return;
    }
    tracks.forEach(mp3 => {
        const li = renderTrackItem(mp3, {
            showDelete: false,
            showImport: false,
            showQueue: true,
            showPlaylist: false,
            extraSubtitle: mp3.subtitle || 'Playlist'
        });
        const removeButton = document.createElement('button');
        removeButton.textContent = '🚫';
        removeButton.title = 'Remove';
        removeButton.className = 'delete-button';
        removeButton.onclick = event => {
            event.stopPropagation();
            removeFromPlaylist(currentPlaylistId, mp3.id);
        };
        li.querySelector('.track-actions').appendChild(removeButton);
        list.appendChild(li);
    });
}

function removeFromPlaylist(playlistId, trackId) {
    fetchApi(resolveApiUrl(`/playlists/${playlistId}/tracks/${trackId}`), {
        method: 'DELETE'
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Failed to remove track');
        }
        return body;
    })
    .then(() => {
        setStatus('Track removed from playlist');
        if (currentPlaylistId) {
            loadPlaylistDetails(currentPlaylistId, document.getElementById('currentPlaylistName').textContent);
        }
    })
    .catch(error => {
        setStatus(`Playlist remove error: ${error.message}`);
    });
}

async function playPlaylist(trackIds, playlistName) {
    if (!Array.isArray(trackIds) || trackIds.length === 0) {
        setStatus('No songs to play from this playlist');
        return;
    }
    const player = document.getElementById('audioPlayer');
    const name = playlistName || 'Playlist';

    currentLoopTrackIds = [...trackIds];

    if (!player.src || player.paused) {
        const [firstId, ...restIds] = trackIds;
        currentTrackId = firstId;
        try {
            await loadAudioSource(resolveApiUrl(`/play/${firstId}`));
            player.load();
            player.play().then(() => setPlayButtonState(true)).catch(error => {
                setStatus(`Playback error: ${error.message}`);
                setPlayButtonState(false);
            });
            updateNowPlaying({ title: `${name}`, subtitle: 'Playing playlist', status: `Playing ${name}` });
            if (restIds.length > 0) {
                await queueTracks(restIds, { silent: true });
            }
            await getQueue();
        } catch (error) {
            setStatus(`Playback error: ${error.message}`);
            setPlayButtonState(false);
        }
    } else {
        await queueTracks(trackIds);
        setStatus(`Queued ${trackIds.length} songs from ${name}`);
    }
}

async function queueCurrentPlaylist() {
    if (!currentPlaylistId || currentLoopTrackIds.length === 0) {
        setStatus('Select a playlist with tracks first'); // Changed from alert
        return;
    }
    await queueTracks(currentLoopTrackIds);
    setStatus(`Queued ${currentLoopTrackIds.length} playlist tracks`);
}

async function playCurrentPlaylist() {
    if (!currentPlaylistId || currentLoopTrackIds.length === 0) {
        setStatus('Select a playlist with tracks first'); // Changed from alert
        return;
    }
    await playPlaylist(currentLoopTrackIds, document.getElementById('currentPlaylistName').textContent || 'Playlist');
}

function importTrack(id) {
    fetchApi(resolveApiUrl(`/import/${id}`), {
        method: 'POST',
        headers: { 'Accept': 'application/json' }
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Import failed');
        }
        return body;
    })
    .then(data => {
        setStatus(`Imported track: ${data.fileName}`);
        getMp3Files();
    })
    .catch(error => {
        setStatus(`Import error: ${error.message}`);
    });
}

let currentTrackId = null;

async function playMp3(id, options = {}) {
    const player = document.getElementById('audioPlayer');
    const { force = false, metadata = null } = options;

    let trackDetails = metadata;
    
    // Only fetch metadata if it wasn't provided (e.g., in a skip operation)
    if (!trackDetails) {
        try {
            const response = await fetchApi(resolveApiUrl(`/track-meta/${id}`));
            if (response.ok) {
                trackDetails = await response.json();
            }
        } catch (error) {
            console.warn('Failed to fetch track details:', error);
        }
    }

    const actualTitle = trackDetails?.file_name || `Track ${id}`;
    const actualSubtitle = trackDetails?.uploaderName ? `By ${trackDetails.uploaderName}` : 'Playing now';

    if (!force && currentTrackId && currentTrackId.toString() === id.toString() && player.src) {
        player.play().then(() => setPlayButtonState(true)).catch(error => {
            setStatus(`Erreur de lecture : ${error.message}`);
            setPlayButtonState(false);
        });
        return;
    }

    if (!currentUser || offlineMode) {
        setStatus('Veuillez vous connecter ou vous reconnecter pour écouter de la musique');
        return;
    }

    currentTrackId = id;
    currentLoopTrackIds = [id]; // Réinitialise la boucle pour la lecture d'une seule piste

    try {
        await loadAudioSource(resolveApiUrl(`/play/${id}`));
        player.load();
        // Attempt to resume AudioContext before playing
        if (audioCtx && audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        player.play().then(() => setPlayButtonState(true)).catch(error => {
            console.error('Error during player.play() in playMp3:', error); // More specific error logging
            setStatus(`Erreur de lecture : ${error.message}`);
            setPlayButtonState(false);
        });
        updateNowPlaying({ title: actualTitle, subtitle: actualSubtitle, status: `Lecture de ${actualTitle}` }); // This was missing await getQueue()
        await getQueue(); // AWAIT here to update queue display
    } catch (error) {
        console.error('Error in playMp3 function:', error); // More specific error logging
        setStatus(`Playback error: ${error.message}`);
        setPlayButtonState(false);
    }
}

async function playPrevFromQueue() { // Made async
    fetchApi(resolveApiUrl('/play-prev'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Play previous failed');
        }
        if (body.playing) {
            playMp3(body.playing.id, { force: true, metadata: body.playing.details });
            setStatus(`Playing previous track ${body.playing.fileName || body.playing.id}`);
            getQueue();
        } else {
            setStatus(body.message || 'No previous track');
        }
    })
    .catch(error => {
        setStatus(`Previous error: ${error.message}`);
    });
}

let loopMode = localStorage.getItem('musica-loop-mode') === 'true';

async function shuffleQueue() { // Made async
    fetchApi(resolveApiUrl('/shuffle'), { method: 'POST', headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Shuffle failed');
        }
        setStatus('Queue shuffled');
        getQueue();
    })
    .catch(error => {
        setStatus(`Shuffle error: ${error.message}`);
    });
}

function toggleLoopMode() {
    loopMode = !loopMode;
    localStorage.setItem('musica-loop-mode', loopMode);
    updateLoopButton();
    setStatus(loopMode ? 'Loop enabled' : 'Loop disabled');
}

function updateLoopButton() {
    const button = document.getElementById('loopBtn');
    const label = document.getElementById('loopStatus');
    if (button) {
        button.textContent = loopMode ? 'Loop On' : 'Loop Off';
        button.classList.toggle('active', loopMode);
    }
    if (label) {
        label.textContent = loopMode ? 'Loop enabled' : 'Loop disabled';
    }
}

async function queueTrack(id, options = {}) {
    const { silent = false } = options;
    const response = await fetchApi(resolveApiUrl(`/queue/${id}`), { method: 'POST', headers: { 'Accept': 'application/json' } });
    const body = await parseJsonOrText(response);
    if (!response.ok) {
        throw new Error(body?.error || body || 'Queue failed');
    }
    if (!silent) {
        setStatus(`Added track ${id} to queue`);
    }
    return body;
}

async function queueTracks(ids, options = {}) {
    console.log('Client: queueTracks called with IDs:', ids);
    // Utilisation de Promise.all pour envoyer toutes les requêtes en parallèle.
    // C'est beaucoup plus fiable pour les opérations groupées sur Render.
    try {
        await Promise.all(ids.map(id => queueTrack(id, options)));
    } catch (err) {
        console.error('Erreur lors de la mise en file d\'attente groupée:', err);
    }
    await getQueue();
}

async function addToQueue(id) { // Made async
    queueTrack(id)
        .then(() => getQueue())
        .catch(error => {
            setStatus(`Queue error: ${error.message}`);
        });
}

async function getQueue() { // Made async
    safeFetch(resolveApiUrl('/queue'), { cacheKey: 'musica-offline-queue' })
    .then(data => {
        if (!Array.isArray(data)) {
            throw new Error('Invalid queue response');
        }
        const queueList = document.getElementById('queueList');
        queueList.innerHTML = '';
        if (data.length > 0) {
            data.forEach(item => {
                const li = document.createElement('li');
                li.className = 'queue-item';
                li.textContent = `${item.fileName} (Track ${item.id})`;
                queueList.appendChild(li);
            });
        } else {
            queueList.innerHTML = '<li style="padding: 10px; text-align: center; color: #999;">Queue is empty</li>';
        }
    })
    .catch(error => {
        console.error('getQueue error:', error);
        setStatus(`Queue load error: ${error.message}`);
    });
}

async function fetchQueueItems() {
    const data = await safeFetch(resolveApiUrl('/queue'), { headers: { 'Accept': 'application/json' } });
    return Array.isArray(data) ? data : [];
}

async function playNextFromQueue() { // Made async
    fetchApi(resolveApiUrl('/play-next'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Play next failed');
        }
        if (body.playing) {
            playMp3(body.playing.id, { force: true, metadata: body.playing.details });
            setStatus(`Playing next track ${body.playing.fileName || body.playing.id}`);
            getQueue();
        } else {
            setStatus(body.message || 'No next track');
        }
    })
    .catch(error => {
        setStatus(`Queue play error: ${error.message}`);
    });
}

function deleteMp3(id) {
    if (!confirm('Delete this track from your library?')) {
        return;
    }

    fetchApi(resolveApiUrl(`/mp3_files/${id}`), {
        method: 'DELETE'
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Delete failed');
        }
        return body;
    })
    .then(() => {
        setStatus(`Deleted track ${id}`);
        getMp3Files();
        getQueue();
    })
    .catch(error => {
        setStatus(`Delete error: ${error.message}`);
    });
}

function stopPlayback() {
    const player = document.getElementById('audioPlayer');
    player.pause();
    player.currentTime = 0;
    setStatus('Playback stopped');
}

async function handleTrackEnd() {
    console.log('Track ended, loopMode:', loopMode, 'currentLoopTrackIds:', currentLoopTrackIds, 'currentTrackId:', currentTrackId);
    if (loopMode && currentLoopTrackIds.length > 1) { // Only loop if it's a playlist (more than 1 track)
        const queueItems = await fetchQueueItems();
        console.log('Queue items:', queueItems.length);
        if (queueItems.length === 0) {
            // Don't loop a single track infinitely - disable loop mode instead
            if (currentLoopTrackIds.length === 1) {
                console.log('Disabling loop mode for single track');
                loopMode = false;
                localStorage.setItem('musica-loop-mode', false);
                setStatus('Loop disabled - single track finished');
                updateLoopButton();
                return;
            } // Removed redundant else block
            console.log('Re-queuing entire playlist for loop:', currentLoopTrackIds);
            await queueTracks(currentLoopTrackIds, { silent: true }); // Re-queue the entire playlist
            // After re-queuing, playNextFromQueue will pick up the first track of the re-queued list
            playNextFromQueue(); // Call playNextFromQueue to get the first track of the re-queued list
            setStatus('Looping playlist');
        }
    }
    console.log('Calling playNextFromQueue');
    playNextFromQueue();
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                registration.update();
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
            })
            .catch(err => console.warn('Service worker registration failed:', err));
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

window.onload = () => {
    const player = document.getElementById('audioPlayer');
    const seekBar = document.getElementById('seekBar');
    player.loop = false;
    player.onended = () => {
        handleTrackEnd().catch(error => console.error('Track end error:', error));
        setPlayButtonState(false);
    };
    player.ontimeupdate = updateSeekBar;
    player.onloadedmetadata = updateSeekBar;
    player.onplay = () => setPlayButtonState(true);
    player.onpause = () => setPlayButtonState(false);
    
    // Initialize Hardware Media Keys (Headphones/Skip buttons)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
        navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrevFromQueue());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNextFromQueue());
        // Support seeking if needed
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime) player.currentTime = details.seekTime;
        });
    }
    
    initVisualizer(); // Initialize AudioContext early
    if (seekBar) {
        seekBar.oninput = (event) => {
            player.currentTime = Number(event.target.value);
            updateSeekBar();
        };
    }

    // Setup Context Menu for Avatar
    const avatar = document.getElementById('headerAvatar');
    const menu = document.getElementById('avatarContextMenu');
    if (avatar) {
        avatar.oncontextmenu = (e) => {
            e.preventDefault();
            menu.style.display = 'block';
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
        };
    }
    // Close context menu if clicking anywhere else
    window.addEventListener('click', (e) => {
        if (menu && menu.style.display === 'block' && !avatar.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });
    window.onclick = () => { if(menu) menu.style.display = 'none'; };

    updateLoopButton();
    showTab('library');
    checkAuth();
};

function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
}
function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}