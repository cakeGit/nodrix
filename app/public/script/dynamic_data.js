(() => {
    'use strict';

    const rootStyle = getComputedStyle(document.documentElement);
    const cssColor = (name) => rootStyle.getPropertyValue(name).trim();

    const COLORS = {
        cpu: cssColor('--chart-cpu'),
        ram: cssColor('--chart-ram'),
        netRx: cssColor('--chart-network-rx'),
        netTx: cssColor('--chart-network-tx'),
        free: cssColor('--chart-free'),
        grid: cssColor('--chart-grid'),
        text: cssColor('--text-color-1'),
    };

    const withAlpha = (hex, alpha) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    };

    const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    function formatBytes(bytes, decimals = 1) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
        const value = bytes / 1024 ** exp;
        const fixed = exp === 0 || value >= 100 ? 0 : decimals;
        return `${value.toFixed(fixed)} ${UNITS[exp]}`;
    }
    const formatRate = (bytesPerSec) => `${formatBytes(bytesPerSec)}/s`;

    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    const clockLabel = (timestamp) =>
        new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });

    Chart.defaults.color = COLORS.text;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 13;

    const gridScales = (yOptions = {}) => ({
        x: {
            grid: { color: COLORS.grid },
            ticks: { maxTicksLimit: 6, maxRotation: 0 },
        },
        y: {
            min: 0,
            max: 100,
            grid: { color: COLORS.grid },
            ticks: { maxTicksLimit: 5, callback: (v) => `${v}%` },
            ...yOptions,
        },
    });

    const MAX_LIVE_SAMPLES = 120;
    const cpuSeries = [];
    const netSeries = [];

    const cpuChart = new Chart(document.getElementById('cpu-history-chart'), {
        type: 'line',
        data: { labels: [], datasets: [{
            data: [],
            borderColor: COLORS.cpu,
            backgroundColor: withAlpha(COLORS.cpu, 0.12),
            fill: true,
            pointRadius: 0,
            borderWidth: 1.5,
            tension: 0.3,
        }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(1)}%` } },
            },
            scales: gridScales(),
        },
    });

    const coresChart = new Chart(document.getElementById('cpu-cores-chart'), {
        type: 'bar',
        data: { labels: [], datasets: [{
            data: [],
            backgroundColor: withAlpha(COLORS.cpu, 0.55),
            borderWidth: 0,
            categoryPercentage: 0.8,
            barPercentage: 0.9,
        }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(1)}%` } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 16, maxRotation: 0 } },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: COLORS.grid },
                    ticks: { maxTicksLimit: 3, callback: (v) => `${v}%` },
                },
            },
        },
    });

    const ramChart = new Chart(document.getElementById('ram-usage-chart'), {
        type: 'doughnut',
        data: {
            labels: ['used', 'free'],
            datasets: [{
                data: [0, 1],
                backgroundColor: [COLORS.ram, COLORS.free],
                borderWidth: 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.label} ${formatBytes(ctx.parsed)}` } },
            },
        },
    });

    const networkChart = new Chart(document.getElementById('network-chart'), {
        type: 'line',
        data: { labels: [], datasets: [
            {
                label: 'rx',
                data: [],
                borderColor: COLORS.netRx,
                backgroundColor: withAlpha(COLORS.netRx, 0.10),
                fill: true,
                pointRadius: 0,
                borderWidth: 1.5,
                tension: 0.3,
            },
            {
                label: 'tx',
                data: [],
                borderColor: COLORS.netTx,
                pointRadius: 0,
                borderWidth: 1.5,
                tension: 0.3,
            },
        ] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: { boxWidth: 10, boxHeight: 10 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} ${formatRate(ctx.parsed.y)}` } },
            },
            scales: {
                x: { grid: { color: COLORS.grid }, ticks: { maxTicksLimit: 5, maxRotation: 0 } },
                y: {
                    grid: { color: COLORS.grid },
                    ticks: { maxTicksLimit: 5, callback: (v) => formatRate(v) },
                },
            },
        },
    });

    function updateCpu(data) {
        const avgPct = Math.round(data.cpu.avg * 100);
        cpuSeries.push({ t: data.statistics_timestamp, v: avgPct });
        if (cpuSeries.length > MAX_LIVE_SAMPLES) cpuSeries.shift();
        cpuChart.data.labels = cpuSeries.map((p) => clockLabel(p.t));
        cpuChart.data.datasets[0].data = cpuSeries.map((p) => p.v);
        cpuChart.update('none');

        const cores = data.cpu.cores;
        if (coresChart.data.labels.length !== cores.length) {
            coresChart.data.labels = cores.map((_, i) => `c${i}`);
        }
        coresChart.data.datasets[0].data = cores.map((v) => Math.round(v * 1000) / 10);
        coresChart.update('none');

        setText('cpu-usage', `${avgPct}%`);
        setText('cpu-loadavg', data.cpu.loadavg.map((v) => v.toFixed(2)).join(' '));
        setText('cpu-cores', String(cores.length));
    }

    function updateRam(data) {
        const m = data.memory;
        const pct = m.total_bytes ? Math.round((m.used_bytes / m.total_bytes) * 100) : 0;
        setText('ram-usage', `${formatBytes(m.used_bytes)} / ${formatBytes(m.total_bytes)} \u00b7 ${pct}%`);
        ramChart.data.datasets[0].data = [m.used_bytes, Math.max(0, m.total_bytes - m.used_bytes)];
        ramChart.update('none');
        setText('ram-swap', m.swap_total_bytes
            ? `${formatBytes(m.swap_used_bytes)} / ${formatBytes(m.swap_total_bytes)}`
            : 'none');
        setText('ram-available', formatBytes(m.available_bytes));
    }

    function buildStorageRow(drive) {
        const row = document.createElement('div');
        row.className = 'storage-row';

        const info = document.createElement('div');
        info.className = 'storage-info';
        const name = document.createElement('span');
        name.textContent = drive.name;
        const usage = document.createElement('span');
        usage.className = 'metatext';
        usage.textContent = ' ';
        if (drive.total_bytes > 0) {
            const pct = Math.min(100, Math.round((drive.used_bytes / drive.total_bytes) * 100));
            const mounts = document.createElement('span');
            mounts.className = 'metatext';
            mounts.textContent = ` ${formatBytes(drive.used_bytes)} / ${formatBytes(drive.total_bytes)} \u00b7 ${pct}% (${drive.mounts.join(', ')})`;
            info.append(name, usage, mounts);
        } else {
            info.append(name, usage);
        }
        row.appendChild(info);

        const bar = document.createElement('div');
        bar.className = 'bar';
        if (drive.total_bytes > 0) {
            const fill = document.createElement('div');
            fill.className = 'bar-fill';
            const pct = Math.min(100, Math.max(1, (drive.used_bytes / drive.total_bytes) * 100));
            fill.style.width = `${pct}%`;
            bar.appendChild(fill);
        }
        row.appendChild(bar);
        return row;
    }

    function updateStorage(data) {
        const drives = data.storage;
        setText('storage-summary', drives.length
            ? `${drives.length} drive${drives.length === 1 ? '' : 's'}`
            : 'none visible');

        const list = document.getElementById('storage-list');
        list.replaceChildren();
        if (drives.length === 0) {
            const hint = document.createElement('div');
            hint.textContent = 'no drives visible - mount host paths into the container to monitor them';
            hint.className = 'metatext';
            list.appendChild(hint);
            return;
        }
        for (const drive of drives) {
            list.appendChild(buildStorageRow(drive));
        }
    }

    function updateNetwork(data) {
        const n = data.network;
        netSeries.push({ t: data.statistics_timestamp, rx: n.rx_bytes_s, tx: n.tx_bytes_s });
        if (netSeries.length > MAX_LIVE_SAMPLES) netSeries.shift();
        networkChart.data.labels = netSeries.map((p) => clockLabel(p.t));
        networkChart.data.datasets[0].data = netSeries.map((p) => p.rx);
        networkChart.data.datasets[1].data = netSeries.map((p) => p.tx);
        networkChart.update('none');

        setText('network-usage', `\u2193 ${formatRate(n.rx_bytes_s)} \u2191 ${formatRate(n.tx_bytes_s)}`);
        setText('network-total-rx', formatBytes(n.rx_total_bytes));
        setText('network-total-tx', formatBytes(n.tx_total_bytes));
    }

    function onMessage(event) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        updateCpu(data);
        updateRam(data);
        updateStorage(data);
        updateNetwork(data);
    }

    const statusElement = document.getElementById('operating-status');
    function setStatus(kind, text) {
        statusElement.className = `status status-${kind}`;
        statusElement.textContent = text;
    }

    const socketUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/data`;
    let retryDelay = 1000;

    function connect() {
        setStatus('warn', 'CONNECT');
        const socket = new WebSocket(socketUrl);
        socket.addEventListener('open', () => {
            retryDelay = 1000;
            setStatus('ok', 'OK');
        });
        socket.addEventListener('message', onMessage);
        socket.addEventListener('close', () => {
            setStatus('warn', 'OFFLINE');
            setTimeout(connect, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30000);
        });
        socket.addEventListener('error', () => socket.close());
    }

    connect();
})();
