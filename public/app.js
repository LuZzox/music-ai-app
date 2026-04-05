const DEFAULT_API_BASE = 'https://music-ai-app.onrender.com';
let API_BASE = DEFAULT_API_BASE;

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
        body: formData
    })
    .then(async response => {
        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json') ? await response.json() : await response.text();

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
    .then(response => response.json())
    .then(data => {
        const list = document.getElementById('mp3List');
        list.innerHTML = '';
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
    })
    .catch(error => {
        setStatus(`Load error: ${error.message}`);
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
    fetch(resolveApiUrl('/play-prev'))
    .then(async response => {
        const body = await response.json();
        if (!response.ok) {
            throw new Error(body?.error || 'Play previous failed');
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

function shuffleQueue() {
    fetch(resolveApiUrl('/shuffle'), { method: 'POST' })
    .then(async response => {
        const body = await response.json();
        if (!response.ok) {
            throw new Error(body?.error || 'Shuffle failed');
        }
        setStatus('Queue shuffled');
        getQueue();
    })
    .catch(error => {
        setStatus(`Shuffle error: ${error.message}`);
    });
}

function addToQueue(id) {
    fetch(resolveApiUrl(`/queue/${id}`), { method: 'POST' })
    .then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(body?.error || 'Queue failed');
        }
        setStatus(`Added track ${id} to queue`);
        getQueue();
    })
    .catch(error => {
        setStatus(`Queue error: ${error.message}`);
    });
}

function getQueue() {
    fetch(resolveApiUrl('/queue'))
    .then(response => response.json())
    .then(data => {
        const queueList = document.getElementById('queueList');
        queueList.innerHTML = '';
        data.forEach(item => {
            const li = document.createElement('li');
            li.className = 'queue-item';
            li.textContent = `${item.fileName} (Track ${item.id})`;
            queueList.appendChild(li);
        });
    })
    .catch(error => {
        setStatus(`Queue load error: ${error.message}`);
    });
}

function playNextFromQueue() {
    fetch(resolveApiUrl('/play-next'))
    .then(async response => {
        const body = await response.json();
        if (!response.ok) {
            throw new Error(body?.error || 'Play next failed');
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
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || 'Delete failed');
        }
        return response.json();
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
    loadBackendUrl();
    const player = document.getElementById('audioPlayer');
    player.onended = () => {
        playNextFromQueue();
    };
    getMp3Files();
    getQueue();
};