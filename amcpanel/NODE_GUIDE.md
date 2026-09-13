# Node Management Guide

## What is a Node?

A node is a machine (local or remote) that runs Minecraft server instances. It acts as a worker managed by the DTG PANEL. Each node runs a daemon process that handles server lifecycle, resource monitoring, file management, and process control.

---

## Architecture

```
DTG PANEL (this server)
        │
        ▼
   Node Daemon (local or remote)
        │
        ▼
   Minecraft Server Instances
```

- **Panel**: Sends commands to node daemons via API (port 8080)
- **Node Daemon**: Listens for commands and manages server processes
- **Servers**: Each server assigned to a node gets its own directory, port, and resources

---

## Adding a Local Node

A local node runs on the **same machine** as the panel.

### Step 1: Install Java

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install openjdk-17-jre-headless -y

# CentOS/RHEL
sudo yum install java-17-openjdk -y

# Verify
java -version
```

### Step 2: Create a Daemon User

```bash
sudo adduser --disabled-password --gecos "" amc-daemon
sudo mkdir -p /var/lib/amc/daemon
sudo chown amc-daemon:amc-daemon /var/lib/amc/daemon
```

### Step 3: Install the Daemon

```bash
# Download and install AMC daemon (replace with actual URL)
curl -sSL https://releases.amcpanel.com/daemon/install.sh | sudo bash
```

### Step 4: Configure the Daemon

Edit `/etc/amc-daemon/config.yml`:

```yaml
panel_url: "http://127.0.0.1:3000"
panel_key: "YOUR_NODE_API_KEY"
daemon_port: 8080
sftp_port: 2022
base_dir: "/var/lib/amc/daemon"
```

### Step 5: Start the Daemon

```bash
sudo systemctl enable amc-daemon
sudo systemctl start amc-daemon
sudo systemctl status amc-daemon
```

### Step 6: Register in Panel

1. Go to **Admin Panel → Nodes → Add Node**
2. Fill in:
   - **Name**: `Local-Node` (or any name)
   - **IP Address**: `127.0.0.1`
   - **Port**: `8080`
   - **RAM**: Your total RAM in MB (e.g., `16384`)
   - **CPU**: Your total CPU cores (e.g., `4`)
   - **Disk**: Your total disk in MB (e.g., `102400`)
3. Click **Create Node**
4. Status should change to **online** within seconds

---

## Adding a Remote Node

A remote node runs on a **different machine** than the panel.

### Prerequisites

- A separate server/VPS with a public IP
- SSH access to that server
- Ports `8080` (API) and `2022` (SFTP) open in firewall

### Step 1: Prepare the Remote Server

SSH into the remote server:

```bash
ssh root@REMOTE_SERVER_IP
```

### Step 2: Install Java

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install openjdk-17-jre-headless -y

# CentOS/RHEL
sudo yum install java-17-openjdk -y
```

### Step 3: Create a Daemon User

```bash
sudo adduser --disabled-password --gecos "" amc-daemon
sudo mkdir -p /var/lib/amc/daemon
sudo chown amc-daemon:amc-daemon /var/lib/amc/daemon
```

### Step 4: Install the Daemon

```bash
curl -sSL https://releases.amcpanel.com/daemon/install.sh | sudo bash
```

### Step 5: Configure the Daemon

Edit `/etc/amc-daemon/config.yml`:

```yaml
panel_url: "http://YOUR_PANEL_IP:3000"
panel_key: "YOUR_NODE_API_KEY"
daemon_port: 8080
sftp_port: 2022
base_dir: "/var/lib/amc/daemon"
```

> **Important**: Use the panel's public IP, not `127.0.0.1`.

### Step 6: Open Firewall Ports

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 8080/tcp
sudo ufw allow 2022/tcp
sudo ufw reload

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --permanent --add-port=2022/tcp
sudo firewall-cmd --reload
```

### Step 7: Start the Daemon

```bash
sudo systemctl enable amc-daemon
sudo systemctl start amc-daemon
```

### Step 8: Register in Panel

1. Go to **Admin Panel → Nodes → Add Node**
2. Fill in:
   - **Name**: `US-East-Node` (or descriptive name)
   - **IP Address**: `REMOTE_SERVER_IP` (the remote server's public IP)
   - **Port**: `8080`
   - **Location**: `New York, USA` (or physical location)
   - **RAM**: Remote server's total RAM in MB
   - **CPU**: Remote server's total CPU cores
   - **Disk**: Remote server's total disk in MB
3. Click **Create Node**
4. Status should change to **online** if connection succeeds

---

## Getting the Node API Key

The `panel_key` is generated when you create a node in the panel:

1. Create the node in **Admin → Nodes → Add Node**
2. The API key is shown in the node details or edit drawer
3. Copy it into the daemon's `config.yml` on the remote machine
4. Restart the daemon: `sudo systemctl restart amc-daemon`

---

## Verifying the Connection

### Check Node Status
- **Admin → Nodes** — green dot = online, red = offline

### Check Daemon Logs
```bash
# On the node machine
sudo journalctl -u amc-daemon -f

# Or check directly
sudo systemctl status amc-daemon
```

### Test API Manually
```bash
curl http://NODE_IP:8080/api/status
```

---

## Node Resource Tracking

Each node tracks:
| Resource | Column | Unit |
|----------|--------|------|
| RAM | `memory_allocated` | MB |
| CPU | `cpu_allocated` | cores |
| Disk | `disk_allocated` | MB |

When a server is created, its resources are subtracted from the node's free pool.

---

## Creating a Server on a Node

1. Go to **Admin → Servers → Create Server**
2. In the **Node Assignment** section, select a node
3. Available RAM/CPU/Disk is shown for each node
4. The node must have enough free resources
5. Click **Create Server**

---

## Troubleshooting

### Node shows offline
1. Check daemon is running: `sudo systemctl status amc-daemon`
2. Verify firewall allows port 8080
3. Check daemon config has correct `panel_url` and `panel_key`
4. View logs: `sudo journalctl -u amc-daemon -f`
5. Ensure panel can reach the node: `curl http://NODE_IP:8080/api/status`

### Can't create server on node
1. Node must be **online** (green status)
2. Node must have enough free RAM, CPU, and Disk
3. Target port must not be in use

### Connection refused
- Check firewall on remote server
- Check `panel_url` uses the correct IP (not `127.0.0.1` for remote)
- Verify daemon is listening on the correct port

### Resource bars not updating
- Restart daemon: `sudo systemctl restart amc-daemon`
- Check panel → nodes page for last updated timestamp

---

## Best Practices

1. **Naming**: Use location-based names like `US-East-1`, `EU-West-2`
2. **Overallocation**: Start with 0-25% and increase based on actual usage
3. **Monitoring**: Check node status regularly — offline nodes can't run servers
4. **Distribution**: Spread servers across multiple nodes for redundancy
5. **Headroom**: Keep 10-20% resources free for OS and overhead
6. **Security**: Use firewall rules to restrict daemon access to panel IP only
