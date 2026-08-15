# Nodrix
A Node.js based node monitoring system, built for docker.
[See it in action](https://node0.oreostack.uk)

Real-time CPU (per core + load average), RAM (with swap), per-mount storage and
network throughput, streamed over WebSockets to a lightweight, no-database UI.

## Run

```sh
docker run -d -p 8000:8000 \
  -v /:/host:ro \
  -v /proc:/host/proc:ro \
  -v /path/to/nodrix_config.json:/app/data/nodrix_config.json:ro \
  ghcr.io/<owner>/nodrix
```

- `-v /:/host:ro` — mount the host root read-only so storage monitoring sees real
  host disks (auto-detected; without it only the container filesystem is visible)
- `-v /proc:/host/proc:ro` — host proc for accurate host RAM/swap and network counters
- config file is optional, all keys have defaults

## Configuration (`nodrix_config.json`)

| key | default | description |
| --- | --- | --- |
| `name` | `unnamed-node` | display name shown in the header |
| `storage_paths` | auto-detect | list of mount paths to monitor (e.g. `["/"]`); auto-detect enumerates real filesystems |
| `proc_path` | `/proc` (`/host/proc` if mounted) | procfs source for meminfo/net/dev/mounts |
| `sample_interval_ms` | `5000` | how often live stats are collected/broadcast |

## Development

```sh
cd app
npm install
node index.js   # http://localhost:8000
```

Requires Node >= 18.15 (uses `fs.statfs`).
