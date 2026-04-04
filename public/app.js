const DEFAULT_API_BASE = '';
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
        setStatus('Using local backend');
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

            li.appendChild(thumb);
            li.appendChild(meta);
            li.appendChild(playButton);
            list.appendChild(li);
        });
    })
    .catch(error => {
        setStatus(`Load error: ${error.message}`);
    });
}

function playMp3(id) {
    fetch(resolveApiUrl(`/play/${id}`))
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            setStatus(`Play failed: ${data.error}`);
            return;
        }
        const player = document.getElementById('audioPlayer');
        player.src = data.url;
        player.play();
        setStatus(`Playing: ${data.fileName}`);
    })
    .catch(error => {
        setStatus(`Play error: ${error.message}`);
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
            .catch(err => console.warn('Service worker registration failed:', err));
    });
}

window.onload = () => {
    loadBackendUrl();
    getMp3Files();
};