(() => {
    'use strict';

    const section = document.getElementById('overview-section');
    const list = document.getElementById('overview-list');
    const summaryEl = document.getElementById('overview-summary');
    if (!section || !list) return;

    const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    function formatBytes(bytes, decimals = 1) {
        bytes = Number(bytes);
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const exp = Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0), UNITS.length - 1);
        const value = bytes / 1024 ** exp;
        const fixed = exp === 0 || value >= 100 ? 0 : decimals;
        return `${value.toFixed(fixed)} ${UNITS[exp] ?? 'B'}`;
    }
    const formatRate = (v) => `${formatBytes(v)}/s`;
    const formatPct = (v) => (v == null || !Number.isFinite(Number(v)) ? '-' : `${Math.round(Number(v) * 100)}%`);

    function memPct(node) {
        if (!node.mem_total_bytes) return null;
        return node.mem_used_bytes / node.mem_total_bytes;
    }

    function buildCard(node) {
        const isLink = Boolean(node.url);
        const card = document.createElement(isLink ? 'a' : 'div');
        card.className = 'overview-card' + (node.self ? ' overview-card-self' : '');
        if (isLink) {
            card.href = node.url;
        }

        const top = document.createElement('div');
        top.className = 'overview-top';

        const name = document.createElement('span');
        name.className = 'overview-name';
        name.textContent = node.name || node.url || 'node';
        top.appendChild(name);

        const status = document.createElement('span');
        status.className = 'overview-status';
        const bracketOpen = document.createElement('span');
        bracketOpen.className = 'metatext';
        bracketOpen.textContent = '[';
        const badge = document.createElement('span');
        badge.className = 'status ' + (node.online ? 'status-ok' : 'status-unknown');
        badge.textContent = node.online ? 'ONLINE' : 'OFFLINE';
        const bracketClose = document.createElement('span');
        bracketClose.className = 'metatext';
        bracketClose.textContent = ']';
        status.append(bracketOpen, badge, bracketClose);
        top.appendChild(status);
        card.appendChild(top);

        const metrics = document.createElement('div');
        metrics.className = 'overview-metrics';

        if (!node.online) {
            const off = document.createElement('span');
            off.className = 'overview-offline';
            off.textContent = 'no data - host unreachable';
            metrics.appendChild(off);
            card.appendChild(metrics);
            return card;
        }

        const cpuRow = document.createElement('div');
        cpuRow.className = 'overview-row';
        const cpuLabel = document.createElement('span');
        cpuLabel.className = 'metatext';
        cpuLabel.textContent = 'cpu';
        const cpuValue = document.createElement('span');
        cpuValue.textContent = formatPct(node.cpu_avg);
        cpuRow.append(cpuLabel, cpuValue);
        metrics.appendChild(cpuRow);

        const ramRow = document.createElement('div');
        ramRow.className = 'overview-row';
        const ramLabel = document.createElement('span');
        ramLabel.className = 'metatext';
        ramLabel.textContent = 'ram';
        const ramValue = document.createElement('span');
        const pct = memPct(node);
        ramValue.textContent = (node.mem_used_bytes != null && node.mem_total_bytes)
            ? `${formatBytes(node.mem_used_bytes)} / ${formatBytes(node.mem_total_bytes)} · ${formatPct(pct)}`
            : '-';
        ramRow.append(ramLabel, ramValue);
        metrics.appendChild(ramRow);

        if (node.mem_total_bytes > 0 && pct != null) {
            const bar = document.createElement('div');
            bar.className = 'bar';
            const fill = document.createElement('div');
            fill.className = 'bar-fill';
            fill.style.width = `${Math.min(100, Math.max(1, pct * 100))}%`;
            bar.appendChild(fill);
            metrics.appendChild(bar);
        }

        const netRow = document.createElement('div');
        netRow.className = 'overview-row';
        const netLabel = document.createElement('span');
        netLabel.className = 'metatext';
        netLabel.textContent = 'net';
        const netValue = document.createElement('span');
        netValue.textContent = (node.net_rx_bytes_s != null && node.net_tx_bytes_s != null)
            ? `↓ ${formatRate(node.net_rx_bytes_s)} ↑ ${formatRate(node.net_tx_bytes_s)}`
            : '-';
        netRow.append(netLabel, netValue);
        metrics.appendChild(netRow);

        card.appendChild(metrics);
        return card;
    }

    async function refresh() {
        let payload;
        try {
            const response = await fetch('/api/overview', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            payload = await response.json();
        } catch (err) {
            console.error(`Failed to load overview: ${err.message}`);
            return;
        }
        const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
        if (nodes.length === 0) {
            section.hidden = true;
            return;
        }
        section.hidden = false;
        const online = nodes.filter((n) => n.online).length;
        if (summaryEl) summaryEl.textContent = `${online}/${nodes.length} online`;
        list.replaceChildren();
        for (const node of nodes) {
            list.appendChild(buildCard(node));
        }
    }

    refresh();
    setInterval(refresh, 5000);
})();
