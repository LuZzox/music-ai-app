const DEFAULT_API_BASE = 'https://music-ai-app.onrender.com';
let API_BASE = DEFAULT_API_BASE;
let currentUser = null;

function setStatus(message) {
    document.getElementById('playerStatus').textContent = message;
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
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
}

function showApp() {
    document.getElementById('authPanel').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
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

function uploadMusic() {
    const fileInput = document.getElementById('musicFile');
    const file = fileInput.files[0];

    if (!file) {
        alert('Please select a music file to upload.');
        return;
    }

    const formData = new FormData();
    formData.append('music', file);

    fetch(resolveApiUrl('/upload'), {
        method: 'POST',
        body: formData,
        headers: {
            'Accept': 'application/json'
        }
    })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            const message = body && body.error ? body.error : body;
            throw new Error(message || 'Upload failed');
        }
        return body;
    })
    .then(data => {
        fileInput.value = '';
        setStatus(`Uploaded: ${data.fileName}`);
        getMp3Files();
        getQueue();
    })
    .catch(error => {
        setStatus(`Upload error: ${error.message}`);
    });
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
            thumb.textContent = mp3.file_name.charAt(0).toUpperCase();

            const meta = document.createElement('div');
            meta.className = 'track-meta';

            const title = document.createElement('span');
            title.textContent = `${mp3.file_name}`;
            const subtitle = document.createElement('small');
            subtitle.textContent = `Track ${mp3.id}`;

            meta.appendChild(title);
            meta.appendChild(subtitle);

            const playButton = document.createElement('button');
            playButton.textContent = 'Play';
            playButton.onclick = () => playMp3(mp3.id);

            const queueButton = document.createElement('button');
            queueButton.textContent = 'Queue';
            queueButton.className = 'queue-button';
            queueButton.onclick = () => addToQueue(mp3.id);

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.className = 'delete-button';
            deleteButton.onclick = () => deleteMp3(mp3.id);

            const actions = document.createElement('div');
            actions.className = 'track-actions';
            actions.appendChild(playButton);
            actions.appendChild(queueButton);
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

let currentTrackId = null;

function playMp3(id) {
    const player = document.getElementById('audioPlayer');
    currentTrackId = id;
    player.src = resolveApiUrl(`/play/${id}`);
    player.load();
    player.play().catch(error => {
        setStatus(`Playback error: ${error.message}`);
    });
    setStatus(`Playing track ${id}`);
}

function playPrevFromQueue() {
    fetch(resolveApiUrl('/play-prev'), { headers: { 'Accept': 'application/json' } })
    .then(async response => {
        const body = await parseJsonOrText(response);
        if (!response.ok) {
            throw new Error(body?.error || body || 'Play previous failed');
        }
        if (body.playing) {
            playMp3(body.playing.id);
            setStatus(`Playing previous track ${body.playing.id}`);
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
            playMp3(body.playing.id);
            setStatus(`Playing next track ${body.playing.id}`);
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
    player.loop = loopMode;
    player.onended = () => {
        if (!loopMode) {
            playNextFromQueue();
        }
    };
    updateLoopButton();
    checkAuth();
};