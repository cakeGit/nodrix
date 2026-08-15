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

function readTrimmed(filePath) {
    try {
        return fs.readFileSync(filePath, "utf8").trim() || null;
    } catch {
        return null;
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

const SYS_ROOT = (() => {
    if (HOST_ROOT && fs.existsSync(path.join(HOST_ROOT, "sys/class/block"))) {
        return path.join(HOST_ROOT, "sys");
    }
    return fs.existsSync("/sys/class/block") ? "/sys" : null;
})();

const { version } = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
);

const JUNK_VALUE = /^(to be filled|default string|not specified|not available|none|unknown|null|oem|system manufacturer|system product name|standard)/i;

function cleanVendorString(value) {
    const cleaned = value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
    return cleaned && !JUNK_VALUE.test(cleaned) ? cleaned : null;
}

function resolveHostname() {
    return (
        (HOST_ROOT && readTrimmed(path.join(HOST_ROOT, "etc/hostname"))) ||
        readTrimmed("/etc/hostname") ||
        os.hostname() ||
        null
    );
}

function collectSystemModel() {
    if (SYS_ROOT) {
        const dmi = path.join(SYS_ROOT, "class/dmi/id");
        const vendor = cleanVendorString(readTrimmed(path.join(dmi, "sys_vendor")) || "");
        const product = cleanVendorString(readTrimmed(path.join(dmi, "product_name")) || "");
        const parts = [vendor, product].filter(Boolean);
        if (parts.length > 0) return parts.join(" ");
    }
    for (const candidate of [
        HOST_ROOT ? path.join(HOST_ROOT, "proc/device-tree/model") : null,
        "/proc/device-tree/model",
    ].filter(Boolean)) {
        const model = cleanVendorString(readTrimmed(candidate) || "");
        if (model) return model;
    }
    return null;
}

function collectOsName() {
    for (const candidate of [
        HOST_ROOT ? path.join(HOST_ROOT, "etc/os-release") : null,
        "/etc/os-release",
        HOST_ROOT ? path.join(HOST_ROOT, "usr/lib/os-release") : null,
        "/usr/lib/os-release",
    ].filter(Boolean)) {
        const release = readTrimmed(candidate);
        if (!release) continue;
        const fields = {};
        for (const line of release.split("\n")) {
            const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*?))\s*$/);
            if (match) fields[match[1]] = match[2] ?? match[3];
        }
        const pretty = fields.PRETTY_NAME || fields.NAME;
        if (pretty) return pretty;
    }
    return null;
}

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

const fsDevices = new Map();

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

const VIRTUAL_DRIVE = /^(loop\d*|ram\d+|zram\d*|dm-\d+|nbd\d+|md\d+|sr\d+)$/;

function listPhysicalDrives() {
    if (!SYS_ROOT) return [];
    const blockDir = path.join(SYS_ROOT, "class/block");
    let entries;
    try {
        entries = fs.readdirSync(blockDir);
    } catch {
        return [];
    }
    const drives = [];
    for (const name of entries) {
        if (VIRTUAL_DRIVE.test(name)) continue;
        const base = path.join(blockDir, name);
        try {
            if (fs.existsSync(path.join(base, "partition"))) continue;
            const sectors = Number(readTrimmed(path.join(base, "size")));
            if (!Number.isFinite(sectors) || sectors <= 0) continue;
            drives.push({
                device: name,
                size_bytes: sectors * 512,
                model: cleanVendorString(readTrimmed(path.join(base, "device/model")) || ""),
            });
        } catch {}
    }
    return drives;
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
    for (const { mountpoint, device } of byDevice.values()) {
        const monitorPath = HOST_ROOT
            ? mountpoint === HOST_ROOT || mountpoint.startsWith(`${HOST_ROOT}/`)
                ? mountpoint
                : path.join(HOST_ROOT, mountpoint)
            : mountpoint;
        paths.push(monitorPath);
        fsDevices.set(monitorPath, device);
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
    const usageByDrive = new Map();
    const seenFilesystems = new Set();
    const extras = [];
    for (const p of storagePaths) {
        try {
            const st = await fs.promises.statfs(p);
            const totalBytes = st.blocks * st.bsize;
            if (!totalBytes) continue;
            const usedBytes = totalBytes - st.bfree * st.bsize;
            const device = fsDevices.get(p);
            const drive = device?.startsWith("/dev/")
                ? readPhysicalDrive(device.slice(5))
                : null;
            if (drive) {
                if (seenFilesystems.has(device)) continue;
                seenFilesystems.add(device);
                const entry = usageByDrive.get(drive) || { used_bytes: 0, total_bytes: 0 };
                entry.used_bytes += usedBytes;
                entry.total_bytes += totalBytes;
                usageByDrive.set(drive, entry);
            } else {
                const label = p.replace(/^\/host/, "") || "/";
                extras.push({ name: label, device: null, total_bytes: totalBytes, used_bytes: usedBytes });
            }
        } catch {}
    }

    const drives = listPhysicalDrives().map((d) => ({
        name: d.model || d.device,
        device: d.device,
        total_bytes: d.size_bytes,
        used_bytes: usageByDrive.has(d.device) ? usageByDrive.get(d.device).used_bytes : null,
    }));
    for (const [device, entry] of usageByDrive) {
        if (!drives.some((d) => d.device === device)) {
            drives.push({ name: device, device, total_bytes: entry.total_bytes, used_bytes: entry.used_bytes });
        }
    }
    drives.push(...extras);
    return drives.sort((a, b) => a.name.localeCompare(b.name));
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
    name: resolveHostname() || config.name,
    version,
    ip,
    region,
    country,
    os_name: collectOsName(),
    os_model: collectSystemModel(),
    os_cpu: `${os.cpus().length}x ${os.cpus()[0]?.model || "Unknown Model"}`.trim(),
    os_cpu_cores: os.cpus().length,
    os_memory: `${Math.ceil(os.totalmem() / 2 ** 30)}GB`,
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
