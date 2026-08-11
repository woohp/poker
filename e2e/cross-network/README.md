# Cross-network WebRTC test

Runs the deployed poker app with a Chromium host on this machine and a Firefox guest over SSH on another machine. It measures click-to-UI latency and verifies that both Nostr and WebTorrent open data channels.

## Network setup

The remote browser must use a genuinely different network, such as cellular tethering. Tailscale may carry SSH traffic, but do not configure it as an exit node for browser traffic.

The SSH host must have:

- Node.js and npm
- Firefox
- geckodriver available to Selenium
- SSH access from this machine

The runner installs `selenium-webdriver` in a temporary remote directory and removes it afterward. It uses an SSH ControlMaster connection so repeated attempts do not repeat SSH setup.

## Run

Deploy the build being tested first, put the remote machine on its external network, then run:

```sh
npm run test:cross-network -- huis-macbook-pro-372
```

The default is five attempts against `https://woohp.github.io/poker/`. Override it with:

```sh
CROSS_NETWORK_APP_URL=https://example.test/poker/ \
CROSS_NETWORK_ATTEMPTS=10 \
npm run test:cross-network -- huis-macbook-pro-372
```

A positional attempt count also works:

```sh
npm run test:cross-network -- huis-macbook-pro-372 10
```

Use `CROSS_NETWORK_SETTLE_MS` to control how long each browser waits after the room becomes usable for the second transport to connect. The default is 12 seconds.

## Results

Each run reports:

- Guest Join click to `Players (2/10)`
- Host observation time using the two machines' wall clocks
- Nostr `peer-connect` time
- WebTorrent `peer-connect` time
- Whether both transports connected on both browsers

Raw structured diagnostics are written under `e2e/cross-network/results/` and are ignored by Git.

The command exits nonzero if either provider does not establish a data channel on either browser during any attempt.
