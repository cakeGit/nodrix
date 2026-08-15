import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { publicIpv4 } from "public-ip";
import geoip from "doc999tor-fast-geoip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8000;

function readConfig(filePath, baseConfig) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return { ...baseConfig, ...data };
    } catch {
        return baseConfig;
    }
}

const HOST_ROOT = (() => {
    try {
        return fs.statSync("/host").isDirectory() ? "/host" : null;
    } catch {
        return null;
    }
})();

const HOST_PROC =
    HOST_ROOT && fs.existsSync(path.join(HOST_ROOT, "proc/meminfo"))
        ? path.join(HOST_ROOT, "proc")
        : null;

const { version } = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
);

const config = readConfig(path.join(__dirname, "data", "nodrix_config.json"), {
    name: "unnamed-node",
    sample_interval_ms: 5_000,
    storage_paths: null,
    proc_path: HOST_PROC || "/proc",
});

const procFile = (name) => path.join(config.proc_path, name);

const REAL_FS_TYPES = new Set([
    "ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "vfat", "exfat",
    "ntfs", "ntfs3", "apfs", "jfs", "ufs", "f2fs",
]);

const fsTypes = new Map();
const devices = new Map();

function readPhysicalDrive(baseName) {
    try {
        const target = fs.readlinkSync(`/sys/class/block/${baseName}`);
        return path.basename(path.dirname(target));
    } catch {}
    const parts = baseName.split("/").pop();
    let sep = parts.match(/^(.+)p\d+$/);
    if (sep) return sep[1];
    const digits = parts.match(/^(.+?)(\d+)$/);
    if (digits && /[a-z]$/i.test(digits[1])) return digits[1];
    return parts;
}

function resolveStoragePaths() {
    if (Array.isArray(config.storage_paths) && config.storage_paths.length > 0) {
        return config.storage_paths.slice(0, 12);
    }

    let mounts = null;
    for (const candidate of [procFile("mounts"), "/proc/self/mounts"]) {
        try {
            mounts = fs.readFileSync(candidate, "utf8");
            break;
        } catch {}
    }

    const byDevice = new Map();
    if (mounts) {
        for (const line of mounts.split("\n")) {
            const parts = line.split(/\s+/);
            if (parts.length < 3) continue;
            const device = parts[0];
            const mountpoint = parts[1].replace(/\\040/g, " ");
            const fstype = parts[2];
            if (!REAL_FS_TYPES.has(fstype)) continue;
            if (!HOST_ROOT && /^(\/proc|\/sys|\/dev|\/run)/.test(mountpoint)) continue;
            const key = device.startsWith("/dev/") ? device : `${device}:${mountpoint}`;
            const existing = byDevice.get(key);
            if (existing && existing.mountpoint.length <= mountpoint.length) continue;
            byDevice.set(key, { mountpoint, fstype, device });
        }
    }
    const paths = [];
    for (const { mountpoint, fstype, device } of byDevice.values()) {
        const monitorPath = HOST_ROOT ? path.join(HOST_ROOT, mountpoint) : mountpoint;
        paths.push(monitorPath);
        fsTypes.set(monitorPath, fstype);
        devices.set(monitorPath, device);
    }
    if (paths.length === 0) paths.push(HOST_ROOT || "/");
    return paths.sort((a, b) => {
        const aLabel = a.replace(/^\/host/, "") || "/";
        const bLabel = b.replace(/^\/host/, "") || "/";
        if (aLabel === "/") return -1;
        if (bLabel === "/") return 1;
        return aLabel.localeCompare(bLabel);
    }).slice(0, 12);
}

const storagePaths = resolveStoragePaths();

async function collectStorage() {
    const byDrive = new Map();
    for (const p of storagePaths) {
        try {
            const st = await fs.promises.statfs(p);
            const totalBytes = st.blocks * st.bsize;
            if (!totalBytes) continue;
            const usedBytes = totalBytes - st.bfree * st.bsize;
            const label = p.replace(/^\/host/, "") || "/";
            const device = devices.get(p);
            const name = device?.startsWith("/dev/")
                ? readPhysicalDrive(device.slice(5))
                : null;
            const key = name || `mnt:${label}`;
            const drive = byDrive.get(key) || { name: name || label, total_bytes: 0, used_bytes: 0, mounts: [] };
            drive.total_bytes += totalBytes;
            drive.used_bytes += usedBytes;
            drive.mounts.push(label);
            byDrive.set(key, drive);
        } catch {}
    }
    return [...byDrive.values()]
        .map((d) => ({ ...d, mounts: d.mounts.sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function collectMemory() {
    try {
        const info = {};
        for (const line of fs.readFileSync(procFile("meminfo"), "utf8").split("\n")) {
            const match = line.match(/^(\w+):\s+(\d+)/);
            if (match) info[match[1]] = Number(match[2]) * 1024;
        }
        const total = info.MemTotal;
        if (!total) throw new Error("meminfo unusable");
        const available = info.MemAvailable ?? os.freemem();
        const swapTotal = info.SwapTotal || 0;
        const swapFree = info.SwapFree ?? swapTotal;
        return {
            total_bytes: total,
            available_bytes: available,
            used_bytes: total - available,
            swap_total_bytes: swapTotal,
            swap_used_bytes: Math.max(0, swapTotal - swapFree),
        };
    } catch {
        const total = os.totalmem();
        const free = os.freemem();
        return {
            total_bytes: total,
            available_bytes: free,
            used_bytes: total - free,
            swap_total_bytes: 0,
            swap_used_bytes: 0,
        };
    }
}

const NET_EXCLUDE = /^(lo|docker0|br-|veth|tap|tun|virbr|zt|wg|cali|flannel|cni|dummy|sit0|ip6tnl0|docker_gwbridge)/;

function collectNetworkTotals() {
    const totals = { rx: 0, tx: 0 };
    try {
        const lines = fs.readFileSync(procFile("net/dev"), "utf8").split("\n").slice(2);
        for (const line of lines) {
            const [iface, rest] = line.split(":");
            if (!rest) continue;
            if (NET_EXCLUDE.test(iface.trim())) continue;
            const cols = rest.trim().split(/\s+/).map(Number);
            if (cols.length < 16) continue;
            totals.rx += cols[0] || 0;
            totals.tx += cols[9] || 0;
        }
    } catch {}
    return totals;
}

let previousCpuTimes = os.cpus().map((cpu) => ({ ...cpu.times }));
let previousNetwork = null;
let previousNetworkTime = null;

function collectCpu() {
    const currentCpuTimes = os.cpus().map((cpu) => ({ ...cpu.times }));
    const cores = currentCpuTimes.map((current, index) => {
        const previous = previousCpuTimes[index] ?? current;
        const totalDiff = Object.keys(current).reduce(
            (acc, key) => acc + Math.max(0, current[key] - previous[key]),
            0
        );
        const idleDiff = Math.max(0, current.idle - previous.idle);
        if (totalDiff === 0) return null;
        return 1 - idleDiff / totalDiff;
    });
    previousCpuTimes = currentCpuTimes;
    const valid = cores.filter((v) => v !== null);
    const coreValues = cores.map((v) => (v === null ? 0 : v));
    return {
        cores: coreValues,
        avg: valid.length ? valid.reduce((a, v) => a + v, 0) / valid.length : 0,
        loadavg: os.loadavg(),
    };
}

function collectNetworkRate() {
    const totals = collectNetworkTotals();
    const now = Date.now();
    let rate = { rx_bytes_s: 0, tx_bytes_s: 0 };
    if (previousNetwork && previousNetworkTime) {
        const seconds = (now - previousNetworkTime) / 1000;
        if (seconds > 0) {
            const rx = (totals.rx - previousNetwork.rx) / seconds;
            const tx = (totals.tx - previousNetwork.tx) / seconds;
            rate = {
                rx_bytes_s: Math.max(0, rx),
                tx_bytes_s: Math.max(0, tx),
            };
        }
    }
    previousNetwork = totals;
    previousNetworkTime = now;
    return {
        rx_bytes_s: rate.rx_bytes_s,
        tx_bytes_s: rate.tx_bytes_s,
        rx_total_bytes: totals.rx,
        tx_total_bytes: totals.tx,
    };
}

const app = express();

let ip = "unknown";
let region = "unknown";
let country = "unknown";
try {
    ip = await publicIpv4();
    const geo = (await geoip.lookup(ip)) || {};
    region = geo.region || "unknown";
    country = geo.country || "unknown";
} catch (err) {
    console.error(`Geo/IP lookup failed, continuing without it: ${err.message}`);
}

const meta = {
    name: config.name,
    version,
    ip,
    region,
    country,
    os_cpu: `${os.cpus().length}x ${os.cpus()[0]?.model || "Unknown Model"}`.trim(),
    os_cpu_cores: os.cpus().length,
    os_memory: `${Math.round(os.totalmem() / 2 ** 30)}GB`,
    os_platform: `${os.platform()}-${os.arch()}`,
    uptime: Date.now(),
    os_uptime: Date.now() - os.uptime() * 1000,
};

app.get("/meta", (req, res) => {
    res.json(meta);
});

app.use(express.static("public"));

const server = app.listen(port, () => {
    console.log(`nodrix v${version} listening on http://localhost:${port}`);
    console.log(
        `monitoring mounts: ${storagePaths.map((p) => p.replace(/^\/host/, "") || "/").join(", ")}`
    );
    console.log(`proc source: ${config.proc_path}`);
});

const activeConnections = new Set();
const wss = new WebSocketServer({ server, path: "/data" });

wss.on("connection", (ws) => {
    activeConnections.add(ws);
    ws.on("close", () => activeConnections.delete(ws));
    ws.on("error", () => activeConnections.delete(ws));
});

async function collectStreamData() {
    const cpu = collectCpu();
    const memory = collectMemory();
    const network = collectNetworkRate();
    const storage = await collectStorage();
    return {
        statistics_timestamp: Date.now(),
        cpu,
        memory,
        storage,
        network,
        active_connections: activeConnections.size,
    };
}

setInterval(async () => {
    let data;
    try {
        data = await collectStreamData();
    } catch (err) {
        console.error(`Error collecting stats: ${err.message}`);
        return;
    }

    const payload = JSON.stringify(data);
    for (const ws of activeConnections) {
        if (ws.readyState === ws.OPEN) {
            ws.send(payload);
        } else {
            activeConnections.delete(ws);
        }
    }
}, config.sample_interval_ms);
