# SSL/TLS & Let's Encrypt Setup Guide

This repository documents an end-to-end implementation of a secure web server using Google Cloud Platform (GCP), Node.js, Nginx, and Let's Encrypt. It covers the complete lifecycle from provisioning infrastructure to issuing and auto-renewing SSL/TLS certificates.

## Core Concepts Learned

1. **SSL/TLS & Asymmetric Encryption:** Using Public/Private key pairs to encrypt data in transit.
2. **Certificate Authorities (CAs):** Understanding how trusted entities (like Let's Encrypt or Google Trust Services) verify domain ownership and sign digital certificates.
3. **The Chain of Trust:** How browsers verify a Leaf Certificate against Intermediate and Root Certificates hardcoded into the OS/Browser.
4. **ACME Protocol & HTTP-01 Challenge:** The automated process Certbot uses to prove domain ownership by placing a temporary token at `.well-known/acme-challenge/`.
5. **Reverse Proxy & SSL Termination:** Configuring Nginx to decrypt incoming HTTPS traffic at the edge and forward it as plain HTTP to an internal Node.js application.

## Tech Stack
* **Cloud Provider:** Google Cloud Platform (GCP Compute Engine)
* **OS:** Ubuntu 22.04 LTS
* **Web Server:** Nginx
* **Application:** Node.js (with PM2 for process management)
* **Certificate Authority:** Let's Encrypt (via Certbot)
* **DNS:** DuckDNS (Dynamic DNS for testing)

---

## Step-by-Step Implementation

### 1. Provision GCP Infrastructure
Create a static IP, open firewall ports (80/443), and spin up an Ubuntu VM.

```bash
# 1. Reserve Static IP
gcloud compute addresses create lets-encrypt-ip --region=us-central1

# 2. Get the assigned IP (Map this to your DuckDNS domain)
gcloud compute addresses describe lets-encrypt-ip --region=us-central1 --format="get(address)"

# 3. Open Firewall for HTTP/HTTPS
gcloud compute firewall-rules create allow-http-https \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=web-server

# 4. Create Ubuntu VM
gcloud compute instances create lets-encrypt-vm \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=web-server \
  --address=lets-encrypt-ip
