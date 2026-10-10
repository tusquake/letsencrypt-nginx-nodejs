# Secure Node.js Deployment: SSL/TLS Termination with Nginx and Let's Encrypt on GCP

> **A hands-on, end-to-end walkthrough of putting a real HTTPS padlock on a Node.js app, using Nginx as a reverse proxy, free Let's Encrypt certificates, and a Google Cloud VM, all for roughly the price of a coffee (or nothing, if you tear it down).**

This repository documents my learning journey through SSL/TLS, Let's Encrypt, Nginx, and cloud infrastructure. It covers the **theory** (with real-world analogies), the **exact commands** I ran, the **errors I hit and how I fixed them**, an **AWS equivalence map**, and a **DevOps interview guide** built from what I learned.

---

## Table of Contents

1. [Overview & Tech Stack](#overview--tech-stack)
2. [Core Theoretical Concepts](#core-theoretical-concepts)
3. [End-to-End GCP Setup & Deployment](#end-to-end-gcp-setup--deployment)
4. [Real-World Troubleshooting](#real-world-troubleshooting--errors-faced)
5. [AWS vs. GCP Architecture Matrix](#aws-vs-gcp-equivalent-architecture-matrix)
6. [DevOps & Cloud Interview Guide](#devops--cloud-interview-guide)
7. [Teardown & Cost Optimization](#teardown--cost-optimization)

---

## Overview & Tech Stack

### What was built

A tiny Node.js web server runs privately on **port 3000**. In front of it sits **Nginx**, which listens on ports **80 and 443**, handles all the HTTPS encryption using a free **Let's Encrypt** certificate, and forwards plain HTTP to Node.js behind the scenes. A free **DuckDNS** subdomain points to a **static IP** on a **GCP Compute Engine** VM.

### Why it matters

Almost every production web app you will ever work on has this shape: *the app doesn't deal with encryption; something in front of it does.* Understanding this pattern is foundational for DevOps, backend, and cloud roles.

### Architecture

```
                    INTERNET
                       │
                       │  HTTPS (encrypted, port 443)
                       ▼
        ┌──────────────────────────────┐
        │   GCP VM (Ubuntu 22.04 LTS)  │
        │                              │
        │   ┌──────────────────────┐   │
        │   │  Nginx  (:80 / :443) │   │  ← SSL termination happens HERE
        │   │  Cert from Certbot   │   │
        │   └──────────┬───────────┘   │
        │              │ plain HTTP    │
        │              ▼ (localhost)   │
        │   ┌──────────────────────┐   │
        │   │  Node.js  (:3000)    │   │  ← managed by PM2
        │   └──────────────────────┘   │
        └──────────────────────────────┘
                       ▲
        DuckDNS: your-subdomain.duckdns.org → Static IP
```

### Tech Stack

| Layer | Technology | Role |
|---|---|---|
| Cloud | **GCP Compute Engine** | Hosts the VM |
| OS | **Ubuntu 22.04 LTS** | Server operating system |
| App | **Node.js** (native `http` module) | The actual application |
| Process Manager | **PM2** | Keeps Node alive, restarts on crash, collects logs |
| Web Server / Proxy | **Nginx** | Reverse proxy + SSL termination |
| Certificates | **Certbot (Let's Encrypt)** | Issues and renews free TLS certificates |
| DNS | **DuckDNS** | Free subdomain pointing at our static IP |
| DNS (conceptual) | **AWS Route 53** | What you would use in a real production domain setup |

---

## Core Theoretical Concepts

### 1. SSL/TLS & Asymmetric Encryption

> **Quick note:** "SSL" is the old name. Modern connections use **TLS** (Transport Layer Security). People still say "SSL" out of habit.

TLS uses **asymmetric encryption**: two mathematically linked keys.

| Key | Analogy | Who has it? | What it does |
|---|---|---|---|
| **Public Key** | An **open padlock** | Everyone (it's sent to every visitor) | Locks (encrypts) data |
| **Private Key** | The **vault key** | Only your server, never shared | Unlocks (decrypts) data |

**The analogy:** Imagine you mail thousands of open padlocks to the world. Anyone can snap one onto a box and send it to you. But only *you* own the key that opens it. Even if a thief intercepts the locked box, they can't open it.

> **Key takeaway:** In practice, TLS uses asymmetric crypto only during the **handshake** to safely agree on a shared secret. After that, it switches to faster **symmetric** encryption for the actual data. It's like using the padlock to securely hand over a copy of a house key, then using that key for everything else.

### 2. Certificate Authorities (CAs) & the Chain of Trust

A padlock alone proves nothing. Anyone can claim *"this padlock belongs to your bank."* A **certificate** is a signed document saying *"this public key really belongs to this domain."* The signer is a **Certificate Authority (CA)**.

**The "Passport Authority" analogy:**

| TLS Concept | Passport Analogy |
|---|---|
| **Leaf Certificate** (your domain's cert) | Your **passport**: identifies *you* |
| **Intermediate CA** (e.g., Let's Encrypt R10/R11) | The **Regional Passport Office** that issued it |
| **Root CA** (e.g., ISRG Root X1) | The **Federal Government** everyone ultimately trusts |

```
Root CA (pre-installed in your browser/OS trust store)
   └── signs → Intermediate CA
                  └── signs → Leaf Certificate (your domain)
```

When your browser connects, it checks: *Was this leaf signed by an intermediate? Was that intermediate signed by a root I already trust?* If the chain links up, the padlock turns green. If any link is broken, you get the scary warning page.

> **Key takeaway:** Browsers don't trust *your* site; they trust a short list of Root CAs baked into the OS/browser, and trust flows down the chain.

### 3. ACME Protocol & the HTTP-01 Challenge

**ACME** (Automatic Certificate Management Environment) is the protocol Let's Encrypt uses to issue certs automatically. **Certbot** is the client that speaks ACME on your behalf.

But how does Let's Encrypt know *you* control the domain? It makes you **prove it**.

**HTTP-01 challenge, step by step:**

1. Certbot tells Let's Encrypt: *"I want a cert for `mysite.duckdns.org`."*
2. Let's Encrypt replies: *"Prove it. Place this secret token at a specific URL."*
3. Certbot (via Nginx) temporarily serves the token at:
   ```
   http://mysite.duckdns.org/.well-known/acme-challenge/<TOKEN>
   ```
4. Let's Encrypt visits that URL from the outside. If it finds the right token, you've proven control.
5. The certificate is issued.

**Analogy:** A bank wants to verify you live at an address. They send a secret code by mail to that address. If you can read it back, you clearly have access to that mailbox.

> **Why ports 80 and 443 must be open:** Let's Encrypt connects *to you* on port 80 for this challenge. If your firewall blocks it, validation fails.

### 4. Reverse Proxy & SSL Termination

A **reverse proxy** sits in front of your app and forwards client requests to it. **SSL termination** means the proxy is where the encrypted connection *ends* (gets "terminated"), and traffic continues to the app unencrypted.

**The "High-Security Embassy Guard" analogy:**

| Real world | Our setup |
|---|---|
| **Armored car** driving up to the embassy | **HTTPS** traffic over the internet |
| **Guard at the gate** checks the car, unloads the package | **Nginx** decrypts the traffic |
| **Walking inside** the safe compound with the package | **Plain HTTP** from Nginx to Node.js on `localhost:3000` |

The inside of the embassy is already secure (the loopback interface never leaves the machine), so there's no need to keep the package in armor once it's past the guard.

```
Browser ══HTTPS══▶ Nginx ──HTTP──▶ Node.js:3000
        (armored)  (guard)  (walking inside)
```

> **Caveat:** This is safe when Nginx and the app are on the *same host* or a *trusted private network*. If traffic crosses an untrusted network between proxy and app, use "SSL re-encryption" (HTTPS to the backend too).

### 5. Domain Authorization: DNS vs. HTTP Load Balancer

Different platforms validate domain ownership differently. This matters most when you want **wildcards**.

| | **HTTP-based authorization** | **DNS-based authorization** |
|---|---|---|
| **Proof method** | Serve a token at a URL on port 80 | Add a TXT record (`_acme-challenge.domain.com`) in DNS |
| **Let's Encrypt name** | HTTP-01 | DNS-01 |
| **Covers** | A **single, specific hostname** (`app.domain.com`) | A single hostname **or wildcard** (`*.domain.com`) |
| **Needs a reachable server?** | Yes, port 80 must be open | No, only DNS API access |
| **Good for** | One VM, simple setups | Wildcards, internal servers, multi-subdomain setups |
| **Cloud example** | Certbot + Nginx (this repo) | GCP Certificate Manager (DNS authorization), AWS ACM + Route 53 |

> **Key takeaway:** Controlling a *web server* proves you control *one hostname*. Controlling *DNS* proves you control the *entire domain*, which is why wildcards require DNS.

---

## End-to-End GCP Setup & Deployment

> **Prerequisites:** A GCP project with billing enabled, the [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated (`gcloud auth login`), and a free [DuckDNS](https://www.duckdns.org) account.

Set some handy variables first:

```bash
export REGION=us-central1
export ZONE=us-central1-a
export VM_NAME=lets-encrypt-vm
export IP_NAME=lets-encrypt-ip
```

### Step 1: Reserve a Static IP

A normal VM IP changes whenever the VM restarts. DNS needs a stable address, so we reserve one.

```bash
# Reserve the static IP
gcloud compute addresses create $IP_NAME --region=$REGION

# Print the IP (you'll need it for DuckDNS)
gcloud compute addresses describe $IP_NAME \
  --region=$REGION --format="get(address)"
```

> **Cost note:** Reserved IPs that are *not attached* to a running VM can incur charges. Always release them in teardown.

### Step 2: Configure GCP Firewall Rules (Ports 80 & 443)

By default GCP blocks inbound web traffic. We open HTTP (needed for the ACME challenge) and HTTPS (needed for real users), but only for VMs carrying our network tag.

```bash
gcloud compute firewall-rules create allow-http-https \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=web-server
```

### Step 3: Provision the Ubuntu 22.04 VM (`e2-micro`)

```bash
gcloud compute instances create $VM_NAME \
  --zone=$ZONE \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=web-server \
  --address=$IP_NAME
```

SSH in:

```bash
gcloud compute ssh $VM_NAME --zone=$ZONE
```

### Step 4: Map the Domain via DuckDNS

1. Log in at [duckdns.org](https://www.duckdns.org).
2. Create a subdomain, e.g. `your-subdomain` → `your-subdomain.duckdns.org`.
3. Paste the **static IP** from Step 1 into the IP field and click **update ip**.
4. Verify DNS propagation from your laptop:

```bash
nslookup your-subdomain.duckdns.org
# or
dig +short your-subdomain.duckdns.org
```

The output should match your reserved static IP.

### Step 5: Install Dependencies on the VM

> **Heads-up (this bit me, see [Error 2](#error-2-syntaxerror-unexpected-token--constreviver--optionsreviver)):** The default `nodejs` package in Ubuntu 22.04's `apt` repo is **very old (v12.x)**. This guide uses native Node.js code so it works anyway, but for anything serious, install a modern Node version via [NodeSource](https://github.com/nodesource/distributions) or `nvm`.

```bash
sudo apt update
sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx

# Check what you actually got
node -v
nginx -v
certbot --version
```

*(Optional but recommended)* install a current Node.js LTS via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should now show v20.x
```

### Step 6: Write & Run the Node.js App with PM2

We use **only Node's built-in `http` module**, so no `npm install`, no framework, no version headaches.

```bash
mkdir ~/myapp && cd ~/myapp
nano index.js
```

**`index.js`**

```javascript
const http = require('http');

const PORT = 3000;
const HOST = '127.0.0.1'; // only reachable from the VM itself; Nginx fronts it

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <h1> Hello from Node.js behind Nginx!</h1>
    <p>This page was served over HTTPS (terminated at Nginx).</p>
    <p>Request path: ${req.url}</p>
  `);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}/`);
});
```

> Binding to `127.0.0.1` (not `0.0.0.0`) means nobody can bypass Nginx and talk to Node directly from the internet. That's the "inside the embassy" idea in practice.

Run it under **PM2** (so it survives crashes and logouts):

```bash
# Install PM2 globally (or use npx pm2 ...)
sudo npm install -g pm2

pm2 start index.js --name myapp   # start the app
pm2 list                          # see status of all apps
pm2 logs myapp                    # tail the logs (Ctrl+C to exit)

# Optional: survive VM reboots
pm2 startup                       # follow the command it prints
pm2 save
```

Quick local test on the VM:

```bash
curl http://127.0.0.1:3000
```

### Step 7: Configure the Nginx Reverse Proxy

Edit the default site:

```bash
sudo nano /etc/nginx/sites-available/default
```

Replace its contents with:

```nginx
server {
    listen 80;
    server_name your-subdomain.duckdns.org;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

| Directive | What it does |
|---|---|
| `listen 80` | Accept plain HTTP on port 80 (Certbot will add 443 later) |
| `server_name` | Which domain this block answers for. **Certbot uses this to find the right block** |
| `proxy_pass` | Forward requests to Node.js on port 3000 |
| `Upgrade` / `Connection` headers | Allow WebSocket upgrades through the proxy |
| `Host $host` | Pass the original hostname to the app |

Validate and reload:

```bash
sudo nginx -t                 # syntax check, always do this first
sudo systemctl restart nginx
```

Test it: visit `http://your-subdomain.duckdns.org` in a browser. You should see your Node page (over plain HTTP, no padlock yet).

### Step 8: Issue the Let's Encrypt Certificate with Certbot

```bash
sudo certbot --nginx -d your-subdomain.duckdns.org
```

Certbot will:
1. Ask for an email and ToS agreement (first run only).
2. Perform the **HTTP-01 challenge** automatically.
3. Download the certificate to `/etc/letsencrypt/live/your-subdomain.duckdns.org/`.
4. **Rewrite your Nginx config** to add a `listen 443 ssl` block and (if you choose) an HTTP → HTTPS redirect.

Inspect what changed:

```bash
sudo cat /etc/nginx/sites-available/default
sudo certbot certificates
```

Now visit `https://your-subdomain.duckdns.org`. **Padlock!**

Check the cert chain from the command line:

```bash
curl -vI https://your-subdomain.duckdns.org 2>&1 | grep -Ei "issuer|subject|expire"
```

### Step 9: Verify Auto-Renewal

Let's Encrypt certs live for only **90 days**. This is deliberate: short lifetimes limit the damage of a leaked key and force automation. Certbot installs a **`systemd` timer** that runs twice daily and renews any cert within 30 days of expiry.

```bash
# Is the timer active?
sudo systemctl list-timers | grep certbot

# Inspect the timer & service
systemctl status certbot.timer

# Simulate a renewal WITHOUT touching real certs (safe!)
sudo certbot renew --dry-run
```

A successful dry run ends with something like *"Congratulations, all simulated renewals succeeded."*

> **Key takeaway:** Always run `certbot renew --dry-run` after setup. It proves the *entire* renewal pipeline works (DNS, port 80, Nginx plugin) **before** the real expiry date finds the bug for you at 3 AM.

---

## Real-World Troubleshooting & Errors Faced

These are the real errors I hit while deploying. Debugging was where most of the learning happened.

### Error 1: `502 Bad Gateway` on Nginx

**Symptom:** Browser shows *"502 Bad Gateway nginx"*.

**Cause:** Nginx was up and healthy, but when it tried to forward the request to `localhost:3000`, **nothing was listening** (or the app was crashing). Nginx is the guard; the guard is at the gate, but the office behind it is empty.

**How to diagnose:**

```bash
pm2 list                                   # is the app "online" or "errored"?
pm2 logs myapp --lines 50                  # why did it die?
sudo ss -tlnp | grep 3000                  # is anything listening on :3000?
curl -I http://127.0.0.1:3000              # does the app answer directly?
sudo tail -n 50 /var/log/nginx/error.log   # look for "connect() failed (111: Connection refused)"
```

> **Rule of thumb:** `502` ≈ *"I reached the backend (or tried to) and got a bad/no response."* Always check the **backend first**, not Nginx.

### Error 2: `SyntaxError: Unexpected token '.'` (`const reviver = options?.reviver`)

**Symptom:** The PM2 logs showed a crash originating in Express's `body-parser`:

```
const reviver = options?.reviver
                       ^
SyntaxError: Unexpected token '.'
```

**Cause:** The `?.` syntax is **optional chaining**, which requires **Node.js 14+**. The `nodejs` package installed from Ubuntu 22.04's default `apt` repo is **Node 12.x**, which cannot parse it. The newer `body-parser` that Express pulled in uses modern JavaScript the old runtime doesn't understand.

**Fix:** Remove the heavy dependency entirely. I rewrote `index.js` using only the native `http` module (see [Step 6](#step-6-write--run-the-nodejs-app-with-pm2)), which works on any Node version.

**Better long-term fix:** Install a supported Node.js LTS (NodeSource or `nvm`), as shown in Step 5.

```bash
node -v   # always check your runtime version FIRST when you see a SyntaxError on valid modern code
```

> **Key takeaway:** "Works on my laptop" often means *"my laptop has a newer Node than the server."* A `SyntaxError` in a third-party library file is almost always a runtime-version mismatch, not a bug in your code.

### Error 3: PM2 Crash Loops, `Script had too many unstable restarts`

**Symptom:** `pm2 list` showed the app as `errored` with a high restart count, and PM2 eventually gave up with:

```
Script had too many unstable restarts
```

**Cause:** This was a **knock-on effect of Error 2**. The app crashed instantly on every start, so PM2 kept restarting it until it hit its safety limit and stopped trying (a "crash loop").

**Fix:**

```bash
npx pm2 reset all        # clear restart counters
pm2 delete myapp         # remove the broken process entry
# ...rewrite index.js with native http code...
pm2 start index.js --name myapp
pm2 logs myapp           # confirm "Server running on ..."
```

> **Key takeaway:** PM2's crash-loop protection is a feature, not a bug. If you see it, **read `pm2 logs`** to find the *real* error. The restart loop is only the symptom.

### Troubleshooting Cheat Sheet

| Symptom | Likely cause | First thing to check |
|---|---|---|
| `502 Bad Gateway` | Backend down / crashed | `pm2 list`, `pm2 logs` |
| `504 Gateway Timeout` | Backend alive but too slow / hung | App logs, `proxy_read_timeout` |
| `ERR_CONNECTION_REFUSED` | Nginx down or port blocked | `systemctl status nginx`, firewall |
| Certbot: *"Timeout during connect"* | Port 80 blocked | GCP firewall rule, target tags |
| Certbot: *"NXDOMAIN"* / DNS error | DuckDNS not pointing to IP | `dig +short <domain>` |
| `nginx -t` fails | Config syntax error | The line number in the error |
| `SyntaxError` in node_modules | Old Node version | `node -v` |

---

## AWS vs. GCP Equivalent Architecture Matrix

The exact same architecture maps almost one-to-one onto AWS.

| Purpose | **GCP** | **AWS** | Notes |
|---|---|---|---|
| Virtual machine | **Compute Engine** (`e2-micro`) | **EC2** (`t3.micro` / `t2.micro`) | Same Ubuntu 22.04 AMI/image works |
| Fixed public IP | **Reserved Static External IP** | **Elastic IP (EIP)** | Both can bill if left unattached/idle |
| Firewall | **VPC Firewall Rules** (applied via *network tags*) | **Security Groups** (attached to instances) | GCP: tag-based. AWS: group-based, stateful |
| DNS hosting | **Cloud DNS** | **Route 53** | Both support API-driven DNS challenges |
| Managed certs | **Certificate Manager** | **AWS Certificate Manager (ACM)** | Managed, auto-renewing certs |
| CLI | `gcloud` | `aws` | |
| Teardown | `gcloud compute instances delete` | `aws ec2 terminate-instances` | |

### Command comparison

```bash
# ── Static IP ──────────────────────────────────────────
# GCP
gcloud compute addresses create lets-encrypt-ip --region=us-central1
# AWS
aws ec2 allocate-address --domain vpc

# ── Firewall ───────────────────────────────────────────
# GCP
gcloud compute firewall-rules create allow-http-https \
  --rules=tcp:80,tcp:443 --target-tags=web-server
# AWS
aws ec2 authorize-security-group-ingress --group-id sg-xxxx \
  --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id sg-xxxx \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
```

### Certificate management: GCP Certificate Manager vs. AWS Route 53 + ACM

| | **GCP Certificate Manager** | **AWS ACM (with Route 53)** |
|---|---|---|
| What it does | Provisions & auto-renews Google-managed certs | Provisions & auto-renews Amazon-managed certs |
| Validation options | **DNS authorization** (supports wildcards) or **Load Balancer authorization** (per-hostname, no DNS access needed) | **DNS validation** (CNAME record; one-click if domain is in Route 53) or **email validation** |
| Where certs can be used | Google Cloud Load Balancers | ALB, CloudFront, API Gateway |
| Can you export the private key? | No | No (for public certs) |
| Wildcard support | Yes, via DNS authorization | Yes, via DNS validation |

> **Important difference from this repo:** Managed certificates (GCP Certificate Manager, AWS ACM) attach to **load balancers / CDNs**, *not* directly to a VM running Nginx. If you want TLS directly on a VM like we did, use **Certbot**. If you front your app with a cloud load balancer, let the cloud **terminate TLS there** and skip Certbot.

> **Key takeaway:** The *concept* (static IP + firewall + VM + DNS + cert) is universal. Only the product names change. Learn the pattern once, and you can rebuild it on any cloud.

---

## DevOps & Cloud Interview Guide

### Part A: Standard Questions

**Q1. What is SSL/TLS termination?**
> It's the point where an encrypted HTTPS connection is decrypted. Usually this is done by a reverse proxy or load balancer (e.g., Nginx, AWS ALB). Traffic *beyond* that point travels to the backend as plain HTTP (or is re-encrypted if the internal network isn't trusted).

**Q2. Why use a reverse proxy at all?**
> - **SSL termination:** one place to manage certs.
> - **Load balancing:** spread traffic over multiple app instances.
> - **Security:** hide the backend, rate-limit, filter bad requests.
> - **Performance:** caching, compression (gzip/brotli), static file serving.
> - **Flexibility:** route `/api` to one service and `/` to another.

**Q3. Explain the TLS chain of trust.**
> A leaf certificate (your domain) is signed by an intermediate CA, which is signed by a root CA already trusted by the client's OS/browser. The browser verifies each signature up the chain. Servers should send the leaf **plus** intermediates (the "full chain"); the root is already in the client's trust store.

**Q4. What is the ACME protocol?**
> A standardized protocol (RFC 8555) that lets a client (like Certbot) automatically request, validate, issue, and renew certificates from a CA (like Let's Encrypt) without human involvement.

**Q5. What's the difference between HTTP-01 and DNS-01 challenges?**

| | **HTTP-01** | **DNS-01** |
|---|---|---|
| Proof | Serve a token at `http://domain/.well-known/acme-challenge/` | Create a TXT record at `_acme-challenge.domain` |
| Needs port 80 open? | Yes | No |
| Needs DNS API access? | No | Yes |
| Wildcards (`*.domain.com`)? | No | Yes |
| Works for servers not on the internet? | No | Yes (internal/private hosts) |
| Typical use | Single public web server | Wildcards, internal services, load-balanced fleets |

**Q6. What's the difference between a public key and a private key?**
> The public key encrypts / verifies and can be shared freely. The private key decrypts / signs and must never leave the server. A certificate binds the *public* key to a domain name.

**Q7. How does a VPC firewall / security group differ conceptually?**
> Both control which network traffic reaches your instance. GCP firewall rules apply to the network and target instances through **tags or service accounts**; AWS Security Groups are **attached directly to instances** (ENIs) and are stateful.

**Q8. Why use PM2 instead of just `node index.js`?**
> PM2 keeps the process alive after logout, restarts it on crash, can start it on boot, centralizes logs, and can run in cluster mode across CPU cores.

---

### Part B: Tricky / Edge-Case Scenarios

**Q: "What happens if Nginx goes down vs. if Node.js goes down?"**

| Scenario | What the user sees | Why |
|---|---|---|
| **Nginx is down** | `ERR_CONNECTION_REFUSED` / "This site can't be reached" | Nothing is listening on ports 80/443. The connection is rejected at the TCP level before any HTTP happens. |
| **Node.js is down (Nginx up)** | **`502 Bad Gateway`** | Nginx accepts the request, tries to reach `localhost:3000`, and gets *connection refused* from the backend. |
| **Node.js is up but hung / very slow** | **`504 Gateway Timeout`** | Nginx connected successfully but the backend didn't respond within `proxy_read_timeout` (default 60s). |

> **Mnemonic:**
> - **Connection refused** → *the front door* is gone (Nginx).
> - **502** → *front door open, back room empty* (app crashed).
> - **504** → *back room occupied but nobody's answering* (app stuck/slow).

**Q: "Let's Encrypt certs last only 90 days. How do you prevent a production outage?"**

> 1. **Automate renewal.** Certbot installs a `systemd` timer (`certbot.timer`) that runs twice a day and renews certs within 30 days of expiry, giving a ~30-day buffer to fix problems.
> 2. **Test the pipeline.** Run `sudo certbot renew --dry-run` after setup and after any infra change (firewall, DNS, Nginx edits). It exercises the full renewal path against the Let's Encrypt *staging* servers without touching real certs.
> 3. **Reload, don't restart.** Use a deploy hook (`--deploy-hook "systemctl reload nginx"`) so Nginx picks up the new cert with zero downtime. Certbot's Nginx plugin does this for you.
> 4. **Monitor expiry.** Alert at e.g. 14 and 7 days remaining (Prometheus blackbox exporter, Uptime Kuma, cloud monitoring). Never rely on automation alone.
> 5. **Keep port 80 (or DNS API creds) working.** The most common renewal failure is a firewall/DNS change that silently breaks validation.
> 6. **Set a contact email** so Let's Encrypt can warn you.

**Q: "Why terminate SSL at Nginx instead of inside Node.js?"**

> | Reason | Explanation |
> |---|---|
> | **Performance offloading** | Nginx is written in C and heavily optimized for TLS handshakes and connection handling. Node's single-threaded event loop shouldn't spend CPU on crypto. |
> | **Simpler app code** | The app just speaks HTTP. No cert paths, no `https.createServer`, no key handling in your codebase. |
> | **Non-disruptive cert reloads** | `nginx -s reload` swaps certificates gracefully. With Node you'd typically need to restart the process (dropping connections) or write custom reload logic. |
> | **Centralized security** | One place to configure TLS versions, ciphers, HSTS, and redirects for *all* backend apps. |
> | **Privilege separation** | Nginx reads the private key. The app process never needs access to it. |
> | **Port binding** | Nginx binds to 80/443 (privileged); Node can run as an unprivileged user on 3000. |

**Q: "Why can't you get a wildcard certificate using HTTP-01?"**

> A wildcard `*.example.com` claims authority over **every possible subdomain**, including ones that don't exist yet. HTTP-01 only proves you control **one web server** that answers for **one specific hostname**; it can't prove you own every name under the domain. Only control of the **DNS zone** itself proves authority over the whole namespace, so Let's Encrypt **requires DNS-01** (a TXT record at `_acme-challenge.example.com`) for wildcards.

**Q: "A user reports 'connection not private' on your site. How do you debug?"**

> 1. Check expiry: `echo | openssl s_client -connect domain:443 -servername domain 2>/dev/null | openssl x509 -noout -dates`
> 2. Check the chain is complete (using `fullchain.pem`, not just `cert.pem`).
> 3. Verify the cert's domain matches the one being visited (`-noout -subject -ext subjectAltName`).
> 4. Check the system clock (skewed client or server time breaks validity checks).
> 5. Confirm `certbot certificates` and the renewal timer are healthy.

**Q: "Your site works over HTTPS but WebSockets fail. Why?"**

> Nginx needs the `Upgrade` and `Connection` headers forwarded plus `proxy_http_version 1.1` (all present in our config) to proxy the WebSocket handshake correctly.

**Q: "Is traffic between Nginx and Node.js insecure?"**

> On the same host over `127.0.0.1`, traffic never touches a network, so it's generally accepted as safe. Across hosts or untrusted networks, re-encrypt (HTTPS to the backend) or use mutual TLS / a service mesh. This is the "SSL termination vs. SSL passthrough/re-encryption" tradeoff.

---

## Teardown & Cost Optimization

> **Do this when you're done.** Running VMs and reserved-but-unused static IPs keep billing quietly.

```bash
# 1. Delete the VM
gcloud compute instances delete lets-encrypt-vm \
  --zone=us-central1-a --quiet

# 2. Release the static IP (do this AFTER deleting the VM)
gcloud compute addresses delete lets-encrypt-ip \
  --region=us-central1 --quiet

# 3. Remove the firewall rule
gcloud compute firewall-rules delete allow-http-https --quiet
```

Verify nothing is left:

```bash
gcloud compute instances list
gcloud compute addresses list
gcloud compute firewall-rules list --filter="name=allow-http-https"
```

**Cost-saving tips**

| Tip | Why |
|---|---|
| Use `e2-micro` | Smallest general-purpose size; part of GCP's Always Free tier in eligible US regions (check current terms) |
| **Stop** the VM if you'll resume soon | Stopped VMs don't bill for compute (disks and unattached IPs still can) |
| Delete the static IP as soon as the VM is gone | Unattached reserved IPs are charged |
| Set a **billing budget alert** | Catches surprises early |
| Remember to remove the DuckDNS record/pointer | Avoids a dangling DNS name pointing at an IP someone else may later receive |

> **Last thought:** The best way to learn infrastructure is to build it, break it, fix it, and tear it down. That's exactly what this repo captures.

---

### Further Reading

- [Let's Encrypt: How It Works](https://letsencrypt.org/how-it-works/)
- [Certbot Documentation](https://eff-certbot.readthedocs.io/)
- [Nginx Reverse Proxy Docs](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
- [RFC 8555: ACME](https://datatracker.ietf.org/doc/html/rfc8555)
- [PM2 Quick Start](https://pm2.keymetrics.io/docs/usage/quick-start/)

---

*Built while learning. Contributions, corrections, and questions welcome. ⭐ Star the repo if it helped!*
