fetch('/meta')
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        populateServerMeta(data);
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });

function formatSecondsTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
    return parts.join(' ');
}

function populateServerMeta(meta) {
    console.log('Server Meta:', meta);

    document.getElementById('server-platform').textContent = meta.os_platform || 'Unknown';

    document.getElementById('server-name').textContent = meta.name || 'Unnnamed Node';

    document.getElementById('server-ip').textContent = meta.ip || 'Unknown';
    document.getElementById('server-region').textContent = meta.region || 'Unknown';
    document.getElementById('server-country').textContent = meta.country || 'Unknown';

    document.getElementById('server-cpu').textContent = meta.os_cpu || 'Unknown CPU';
    document.getElementById('server-memory').textContent = meta.os_memory || 'Unknown Memory';

    function createUptimeElement(uptimeStart) {
        const uptimeElement = document.createElement('span');
        uptimeElement.textContent = formatSecondsTime((Date.now() - uptimeStart) / 1000);
        setInterval(() => {
            uptimeElement.textContent = formatSecondsTime((Date.now() - uptimeStart) / 1000);
        }, 1000);
        return uptimeElement;
    }

    function span(text) {
        const spanElement = document.createElement('span');
        spanElement.textContent = text;
        return spanElement;
    }

    document.getElementById('server-uptime').appendChild(meta.uptime ? createUptimeElement(meta.uptime) : span('Unknown Uptime'));
    document.getElementById('server-os-uptime').appendChild(meta.os_uptime ? createUptimeElement(meta.os_uptime) : span('Unknown Uptime'));

}