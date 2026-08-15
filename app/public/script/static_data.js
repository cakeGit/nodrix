fetch('/meta')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        populateServerMeta(data);
    })
    .catch(error => {
        console.error(`Failed to load server meta: ${error.message}`);
    });

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (days > 0 || hours > 0) parts.push(`${hours}h`);
    if (days > 0 || minutes > 0) parts.push(`${minutes}m`);
    if (days === 0) parts.push(`${secs}s`);
    return parts.join(' ');
}

function setText(id, value, fallback = 'unknown') {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? fallback;
}

function createUptimeElement(uptimeStart) {
    const element = document.createElement('span');
    const update = () => {
        element.textContent = formatUptime((Date.now() - uptimeStart) / 1000);
    };
    update();
    setInterval(update, 1000);
    return element;
}

function populateServerMeta(meta) {
    setText('server-platform', meta.os_platform, 'unknown platform');
    setText('server-name', meta.name, 'unnamed node');
    setText('server-ip', meta.ip);
    setText('server-region', meta.region);
    setText('server-country', meta.country);
    setText('server-cpu', meta.os_cpu, 'unknown cpu');
    setText('server-memory', meta.os_memory, 'unknown memory');
    setText('nodrix-version', `v${meta.version || '0.0.0'}`);

    document.title = `Nodrix - ${meta.name || 'node'}`;

    const uptimeHost = document.getElementById('server-uptime');
    const osUptimeHost = document.getElementById('server-os-uptime');
    if (uptimeHost) {
        uptimeHost.replaceChildren(
            meta.uptime ? createUptimeElement(meta.uptime) : document.createTextNode('unknown')
        );
    }
    if (osUptimeHost) {
        osUptimeHost.replaceChildren(
            meta.os_uptime ? createUptimeElement(meta.os_uptime) : document.createTextNode('unknown')
        );
    }
}
