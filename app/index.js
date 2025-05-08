import express from "express";
import fs from "fs";
import { publicIpv4 } from "public-ip";
import geoip from "doc999tor-fast-geoip";
import { WebSocketServer } from "ws";
import os from "os";
import sqlite3 from "sqlite3";

fs.mkdirSync("../stats/", { recursive: true });
fs.writeFileSync("../stats/stats.db", "");
const db = new sqlite3.Database("../stats/stats.db");
db.exec(`CREATE TABLE IF NOT EXISTS resource_usage (
    ord INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    os_cpu_usage REAL NOT NULL,
    os_memory_usage REAL NOT NULL
)`, err => {if (err) {
    console.error("Error creating table:", err);
}});
db.serialize();

function writeResourceUsageToStats(cpuUsageMax, ramUsageMax) {
    db.serialize(() => {
        db.run(
            "INSERT INTO resource_usage (timestamp, os_cpu_usage, os_memory_usage) VALUES (?, ?, ?)",
            [Date.now(), cpuUsageMax, ramUsageMax],
            (err) => {
                if (err) {
                    console.error("Error inserting resource usage data:", err);
                }
            }
        );
    });
}

const app = express();
const port = 8000;

const ip = await publicIpv4();
const geo = await geoip.lookup(ip);

var uptimeBegin = new Date();
var osUptimeBegin = new Date(uptimeBegin.getTime() - os.uptime() * 1000);

function readConfig(filePath, baseConfig) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        for (const key in data) {
            baseConfig[key] = data[key];
        }
        return baseConfig;
    } catch (err) {
        console.error(`Error reading config file: ${err}`);
        return baseConfig;
    }
}

const nodrixConfig = readConfig("data/nodrix_config.json", {
    uptime: uptimeBegin.getTime(),
    ip: ip,
    region: geo.region,
    country: geo.country,
    os_cpu: `${os.cpus().length} CPUs - ${
        os.cpus()[0]?.model || "Unknown Model"
    }`,
    os_memory: `${Math.floor(os.totalmem() / 1000000000)}GB`,
    os_platform: `${os.platform()}-${os.arch()}`,
    os_uptime: osUptimeBegin.getTime(),
});

app.get("/meta", async (req, res) => {
    res.json(nodrixConfig);
});

app.use(express.static("public"));

const server = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

const activeConnections = new Set();

const wss = new WebSocketServer({ server, path: "/data" });

wss.on("connection", (ws) => {
    activeConnections.add(ws);

    ws.send(JSON.stringify(collectStreamData()));

    ws.on("close", () => {
        activeConnections.delete(ws);
    });
});
let previousCpuTimes = os.cpus().map((cpu) => ({ ...cpu.times }));

function collectStreamData() {
    const currentCpuTimes = os.cpus().map((cpu) => ({ ...cpu.times }));
    const os_cpu_usage = currentCpuTimes.map((current, index) => {
        const previous = previousCpuTimes[index];
        const totalDiff = Object.keys(current).reduce(
            (acc, key) => acc + (current[key] - previous[key]),
            0
        );
        const idleDiff = current.idle - previous.idle;
        return 1 - idleDiff / totalDiff;
    });

    previousCpuTimes = currentCpuTimes;

    const data = {
        statistics_timestamp: Date.now(),
        os_cpu_usage,
        os_memory_usage: 1 - os.freemem() / os.totalmem(),
        nodrix_memory_usage_of_os: process.memoryUsage().rss / os.totalmem(),
        nodrix_memory_allocated: `${Math.ceil(
            process.memoryUsage().rss / 1000000
        )}MB`,
        active_connections: activeConnections.size,
    };
    return data;
}

const writeInterval = 1000 * 60 * 5;
var lastWrite = Date.now();
var writePeriodMaxCpuUsage = 0;
var writePeriodMaxRamUsage = 0;

setInterval(() => {
    const data = collectStreamData();

    const cpuUsage = data.os_cpu_usage.reduce(
        (acc, val) => acc + val,
        0
    ) / data.os_cpu_usage.length;
    const ramUsage = os.totalmem() - os.freemem();

    writePeriodMaxCpuUsage = Math.max(
        writePeriodMaxCpuUsage,
        cpuUsage
    );
    writePeriodMaxRamUsage = Math.max(
        writePeriodMaxRamUsage,
        ramUsage
    );

    if (Date.now() - lastWrite >= writeInterval) {
        writeResourceUsageToStats(
            writePeriodMaxCpuUsage,
            writePeriodMaxRamUsage
        );
        writePeriodMaxCpuUsage = 0;
        writePeriodMaxRamUsage = 0;
        lastWrite = Date.now();
    }

    if (activeConnections.size === 0) return;
    for (const ws of activeConnections) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(data));
        } else {
            console.log(
                "WebSocket connection is not open, removing from active connections"
            );
            activeConnections.delete(ws);
        }
    }
}, 5000);
