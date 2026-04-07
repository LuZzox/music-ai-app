const DEFAULT_API_BASE = 'https://music-ai-app.onrender.com';
let API_BASE = DEFAULT_API_BASE;
let currentUser = null;
let currentTrackMeta = null;
let currentPlaylistId = null;

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
    applyCoverToElement(document.getElementById('playerCover'), meta.title, meta.coverUrl);
    setStatus(meta.status || 'Ready to play');
}

function getCoverLetter(title) {
    if (!title) return '♫';
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
    if (button) {
        button.textContent = isPlaying ? '⏸️ Pause' : '▶️ Play';
    }
}

function showTab(name) {
    const tabs = ['library', 'search', 'playlist'];
    tabs.forEach(tab => {
        const panel = document.getElementById(`${tab}Tab`);
        const button = document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Btn`);
        if (panel) panel.classList.toggle('active', tab === name);
        if (button) button.classList.toggle('active', tab === name);
    });
    if (name === 'search') {
        searchAllTracks();
    }
    if (name === 'playlist') {
        getPlaylists();
    }
}

function togglePlayPause() {
    const player = document.getElementById('audioPlayer');
    if (player.paused) {
        player.play().then(() => setPlayButtonState(true)).catch(err => setStatus(`Playback failed: ${err.message}`));
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
        alert('Please enter email and password');
        return;
    }

    fetch(resolveApiUrl('/login'), {
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
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        showApp();
        getMp3Files();
        getQueue();
        getPlaylists();
        searchAllTracks();
    })
    .catch(error => {
        alert(`Login error: ${error.message}`);
    });
}

function handleSignup() {
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const displayName = document.getElementById('signupName').value.trim() || email.split('@')[0];

    if (!email || !password) {
        alert('Please enter email and password');
        return;
    }

    fetch(resolveApiUrl('/signup'), {
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
        alert(`Signup error: ${error.message}`);
    });
}

function handleLogout() {
    fetch(resolveApiUrl('/logout'), { method: 'POST' })
    .then(() => {
        currentUser = null;
        document.getElementById('musicFile').value = '';
        showAuth();
    })
    .catch(error => {
        console.error('Logout error:', error);
        currentUser = null;
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
}

function checkAuth() {
    fetch(resolveApiUrl('/auth/user'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok || !body || !body.authenticated) {
            showAuth();
            return;
        }
        currentUser = body.user;
        loadBackendUrl();
        showApp();
        getMp3Files();
        getQueue();
        getPlaylists();
        searchAllTracks();
    })
    .catch(() => {
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
        alert('No valid audio files found.');
        return;
    }

    const CHUNK_SIZE = 3; // very safe for Render free tier
    for (let i = 0; i < audioFiles.length; i += CHUNK_SIZE) {
        const chunk = audioFiles.slice(i, i + CHUNK_SIZE);
        const formData = new FormData();
        chunk.forEach(file => formData.append('music', file));

        try {
            const response = await fetch(resolveApiUrl('/upload'), {
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

function getMp3Files() {
    fetch(resolveApiUrl('/mp3_files'))
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Failed to load tracks');
        }
        if (!Array.isArray(body)) {
            console.error('Expected array, got:', body);
            throw new Error('Invalid response format: expected array of tracks');
        }
        return body;
    })
    .then(data => {
        const list = document.getElementById('mp3List');
        list.innerHTML = '';
        if (data && Array.isArray(data)) {
            data.forEach(mp3 => {
            const li = document.createElement('li');
            li.className = 'track-item';

            const thumb = document.createElement('div');
            thumb.className = 'track-thumb';
            applyCoverToElement(thumb, mp3.file_name, mp3.coverUrl);

            const meta = document.createElement('div');
            meta.className = 'track-meta';

            const title = document.createElement('span');
            title.textContent = `${mp3.file_name}`;
            const subtitle = document.createElement('small');
            subtitle.textContent = `Track ${mp3.id}`;

            meta.appendChild(title);
            meta.appendChild(subtitle);

            const playButton = document.createElement('button');
            playButton.textContent = '▶️ Play';
            playButton.onclick = () => playMp3(mp3.id, mp3.file_name, 'Your library');

            const queueButton = document.createElement('button');
            queueButton.textContent = '➕ Queue';
            queueButton.className = 'queue-button';
            queueButton.onclick = () => addToQueue(mp3.id);

            const playlistButton = document.createElement('button');
            playlistButton.textContent = '🎧 Add to playlist';
            playlistButton.className = 'secondary';
            playlistButton.onclick = () => addTrackToPlaylist(mp3.id);

            const deleteButton = document.createElement('button');
            deleteButton.textContent = '❌ Delete';
            deleteButton.className = 'delete-button';
            deleteButton.onclick = () => deleteMp3(mp3.id);

            const actions = document.createElement('div');
            actions.className = 'track-actions';
            actions.appendChild(playButton);
            actions.appendChild(queueButton);
            actions.appendChild(playlistButton);
            actions.appendChild(deleteButton);

                li.appendChild(thumb);
                li.appendChild(meta);
                li.appendChild(actions);
                list.appendChild(li);
            });
        } else {
            list.innerHTML = '<li style="padding: 20px; text-align: center; color: #999;">No tracks yet</li>';
        }
    })
    .catch(error => {
        console.error('getMp3Files error:', error);
        setStatus(`Load error: ${error.message}`);
        const list = document.getElementById('mp3List');
        list.innerHTML = `<li style="padding: 20px; text-align: center; color: #ff6b6b;">${error.message}</li>`;
    });
}

function searchAllTracks(query) {
    const searchValue = query !== undefined ? query : document.getElementById('searchInput').value.trim();
    const url = resolveApiUrl(`/search?q=${encodeURIComponent(searchValue)}`);
    fetch(url)
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Search failed');
        }
        return body;
    })
    .then(data => {
        renderSearchResults(data);
    })
    .catch(error => {
        console.error('searchAllTracks error:', error);
        setStatus(`Search error: ${error.message}`);
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
        const li = document.createElement('li');
        li.className = 'track-item';

        const thumb = document.createElement('div');
        thumb.className = 'track-thumb';
        applyCoverToElement(thumb, mp3.file_name, mp3.coverUrl);

        const meta = document.createElement('div');
        meta.className = 'track-meta';

        const title = document.createElement('span');
        title.textContent = mp3.file_name;
        const subtitle = document.createElement('small');
        subtitle.textContent = mp3.owned ? 'Your library' : `Shared by ${mp3.uploaderEmail || 'Community'}`;

        meta.appendChild(title);
        meta.appendChild(subtitle);

        const playButton = document.createElement('button');
        playButton.textContent = '▶️ Play';
        playButton.onclick = () => playMp3(mp3.id, mp3.file_name, subtitle.textContent);

        const queueButton = document.createElement('button');
        queueButton.textContent = '➕ Queue';
        queueButton.className = 'queue-button';
        queueButton.onclick = () => addToQueue(mp3.id);

        const actions = document.createElement('div');
        actions.className = 'track-actions';
        actions.appendChild(playButton);
        actions.appendChild(queueButton);

        if (!mp3.owned) {
            const importButton = document.createElement('button');
            importButton.textContent = '📥 Import';
            importButton.className = 'secondary';
            importButton.onclick = () => importTrack(mp3.id);
            actions.appendChild(importButton);
        }

        li.appendChild(thumb);
        li.appendChild(meta);
        li.appendChild(actions);
        list.appendChild(li);
    });
}

function getPlaylists() {
    fetch(resolveApiUrl('/playlists'))
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Failed to load playlists');
        }
        return body;
    })
    .then(data => {
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
        const title = document.createElement('span');
        title.textContent = `${playlist.name} (${playlist.trackCount || 0})`;
        const openButton = document.createElement('button');
        openButton.className = 'secondary';
        openButton.textContent = 'Open';
        openButton.onclick = () => loadPlaylistDetails(playlist.id, playlist.name);
        li.appendChild(title);
        li.appendChild(openButton);
        list.appendChild(li);
    });
}

function createPlaylist() {
    const name = document.getElementById('playlistName').value.trim();
    if (!name) {
        alert('Please enter a playlist name');
        return;
    }
    fetch(resolveApiUrl('/playlists'), {
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
        alert('Select a playlist before adding tracks');
        return;
    }
    fetch(resolveApiUrl(`/playlists/${currentPlaylistId}/tracks`), {
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

function loadPlaylistDetails(id, name) {
    currentPlaylistId = id;
    document.getElementById('currentPlaylistName').textContent = name;
    fetch(resolveApiUrl(`/playlists/${id}`))
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Failed to load playlist');
        }
        return body;
    })
    .then(data => {
        renderPlaylistTracks(data.tracks || []);
    })
    .catch(error => {
        setStatus(`Playlist load error: ${error.message}`);
    });
}

function renderPlaylistTracks(tracks) {
    const list = document.getElementById('playlistTrackList');
    list.innerHTML = '';
    if (!Array.isArray(tracks) || tracks.length === 0) {
        list.innerHTML = '<li style="padding: 16px; text-align: center; color: #999;">No songs in this playlist yet.</li>';
        return;
    }
    tracks.forEach(mp3 => {
        const li = document.createElement('li');
        li.className = 'track-item';
        const thumb = document.createElement('div');
        thumb.className = 'track-thumb';
        applyCoverToElement(thumb, mp3.file_name, mp3.coverUrl);
        const meta = document.createElement('div');
        meta.style.minWidth = '0';

        const title = document.createElement('span');
        title.textContent = mp3.file_name;
        const subtitle = document.createElement('small');
        subtitle.textContent = mp3.subtitle || `Track ${mp3.id}`;

        meta.appendChild(title);
        meta.appendChild(subtitle);

        const actions = document.createElement('div');
        actions.className = 'track-actions';

        const playButton = document.createElement('button');
        playButton.textContent = '▶️ Play';
        playButton.onclick = () => playMp3(mp3.id, mp3.file_name, 'Playlist');

        const queueButton = document.createElement('button');
        queueButton.textContent = '➕ Queue';
        queueButton.className = 'queue-button';
        queueButton.onclick = () => addToQueue(mp3.id);

        const removeButton = document.createElement('button');
        removeButton.textContent = '🚫 Remove';
        removeButton.className = 'delete-button';
        removeButton.onclick = () => removeFromPlaylist(currentPlaylistId, mp3.id);

        actions.appendChild(playButton);
        actions.appendChild(queueButton);
        actions.appendChild(removeButton);

        li.appendChild(thumb);
        li.appendChild(meta);
        li.appendChild(actions);
        list.appendChild(li);
    });
}

function removeFromPlaylist(playlistId, trackId) {
    fetch(resolveApiUrl(`/playlists/${playlistId}/tracks/${trackId}`), {
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

function importTrack(id) {
    fetch(resolveApiUrl(`/import/${id}`), {
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

function playMp3(id, title = '', subtitle = '') {
    const player = document.getElementById('audioPlayer');
    currentTrackId = id;
    player.src = resolveApiUrl(`/play/${id}`);
    player.load();
    player.play().then(() => setPlayButtonState(true)).catch(error => {
        setStatus(`Playback error: ${error.message}`);
        setPlayButtonState(false);
    });
    updateNowPlaying({ title: title || `Track ${id}`, subtitle: subtitle || 'Playing now', cover: title ? title.charAt(0).toUpperCase() : '♫', status: `Playing ${title || id}` });
}

function playPrevFromQueue() {
    fetch(resolveApiUrl('/play-prev'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Play previous failed');
        }
        if (body.playing) {
            playMp3(body.playing.id, body.playing.fileName || `Track ${body.playing.id}`, 'Previous track');
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

function shuffleQueue() {
    fetch(resolveApiUrl('/shuffle'), { method: 'POST', headers: { 'Accept': 'application/json' } })
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
    const player = document.getElementById('audioPlayer');
    player.loop = loopMode;
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

function addToQueue(id) {
    fetch(resolveApiUrl(`/queue/${id}`), { method: 'POST', headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Queue failed');
        }
        setStatus(`Added track ${id} to queue`);
        getQueue();
    })
    .catch(error => {
        setStatus(`Queue error: ${error.message}`);
    });
}

function getQueue() {
    fetch(resolveApiUrl('/queue'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Queue load failed');
        }
        if (!Array.isArray(body)) {
            console.error('Expected array, got:', body);
            throw new Error('Invalid response format: expected array of queue items');
        }
        return body;
    })
    .then(data => {
        const queueList = document.getElementById('queueList');
        queueList.innerHTML = '';
        if (data && Array.isArray(data) && data.length > 0) {
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

function playNextFromQueue() {
    fetch(resolveApiUrl('/play-next'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Play next failed');
        }
        if (body.playing) {
            playMp3(body.playing.id, body.playing.fileName || `Track ${body.playing.id}`, 'Next track');
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

    fetch(resolveApiUrl(`/mp3_files/${id}`), {
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
    player.loop = loopMode;
    player.onended = () => {
        if (!loopMode) {
            playNextFromQueue();
        }
        setPlayButtonState(false);
    };
    player.ontimeupdate = updateSeekBar;
    player.onloadedmetadata = updateSeekBar;
    player.onplay = () => setPlayButtonState(true);
    player.onpause = () => setPlayButtonState(false);
    if (seekBar) {
        seekBar.oninput = (event) => {
            player.currentTime = Number(event.target.value);
            updateSeekBar();
        };
    }
    updateLoopButton();
    showTab('library');
    checkAuth();
};