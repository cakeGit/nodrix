import express from 'express';
import fs from 'fs';
import { publicIpv4 } from 'public-ip';
import geoip from 'doc999tor-fast-geoip';
import { WebSocketServer } from 'ws';
import os from 'os';

const app = express();
const port = 8000;

const ip = await publicIpv4();
const geo = await geoip.lookup(ip);

var uptimeBegin = new Date();
var osUptimeBegin = new Date(uptimeBegin.getTime() - os.uptime() * 1000);

function readConfig(filePath, baseConfig) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const key in data) {
            baseConfig[key] = data[key];
        }
        return baseConfig;
    } catch (err) {
        console.error(`Error reading config file: ${err}`);
        return baseConfig;
    }
}

const nodrixConfig = readConfig('data/nodrix_config.json', {
    uptime: uptimeBegin.getTime(),
    ip: ip,
    region: geo.region,
    country: geo.country,
    os_cpu: `${os.cpus().length} CPUs - ${os.cpus()[0]?.model || 'Unknown Model'}`,
    os_memory: `${Math.floor(os.totalmem() / 1000000000)}GB`,
    os_platform: `${os.platform()}-${os.arch()}`,
    os_uptime: osUptimeBegin.getTime(),
});

app.get('/meta', async (req, res) => {
    res.json(nodrixConfig);
});

app.use(express.static('public'));

const server = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

const activeConnections = new Set();

const wss = new WebSocketServer({ server, path: '/data' });

wss.on('connection', (ws) => {
    activeConnections.add(ws);

    ws.send(JSON.stringify(collectStreamData()));

    ws.on('close', () => {
        activeConnections.delete(ws);
    });
});

function collectStreamData() {
    const data = {
        statistics_timestamp: Date.now(),
        os_cpu_usage: os.cpus().map(cpu => {
            const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
            return 1 - cpu.times.idle / total;
        }),
        os_memory_usage: 1 - os.freemem() / os.totalmem(),
        nodrix_memory_usage_of_os: process.memoryUsage().rss / os.totalmem(),
        nodrix_memory_allocated: `${Math.ceil(process.memoryUsage().rss / 1000000)}MB`,
        active_connections: activeConnections.size,
    }
    return data;
}

setInterval(() => {
    if (activeConnections.size === 0) return; // No active connections

    const data = collectStreamData();

    for (const ws of activeConnections) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(data));
        } else {
            console.log('WebSocket connection is not open, removing from active connections');
            activeConnections.delete(ws);
        }
    }
}, 5000);