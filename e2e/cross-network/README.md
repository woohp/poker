# Cross-network WebRTC test

Runs the poker app with a Chromium host on this machine and a Firefox guest over SSH on another machine. It measures click-to-UI latency and verifies that both Nostr and WebTorrent open data channels. The two browsers can use either the deployed app or matching local dev servers.

## Network setup

The remote browser must use a genuinely different network, such as cellular tethering. Tailscale may carry SSH traffic, but do not configure it as an exit node for browser traffic.

The SSH host must have:

- Node.js and npm
- Firefox
- geckodriver available to Selenium
- SSH access from this machine

The local machine must also have the Playwright Chromium build used by the installed package. Install it when setting up or updating Playwright:

```sh
npx playwright install chromium
```

The runner installs `selenium-webdriver` in a temporary remote directory and removes it afterward. It uses an SSH ControlMaster connection so repeated attempts do not repeat SSH setup.

## Run against the deployed app

Deploy the build being tested first, put the remote machine on its external network, then run:

```sh
npm run test:cross-network -- <ssh-host>
```

The default is five attempts against `https://woohp.github.io/poker/`. Override it with:

```sh
CROSS_NETWORK_APP_URL=https://example.test/poker/ \
CROSS_NETWORK_ATTEMPTS=10 \
npm run test:cross-network -- <ssh-host>
```

A positional attempt count also works:

```sh
npm run test:cross-network -- <ssh-host> 10
```

## Run matching local dev servers

Use this workflow to test uncommitted code without deploying it. Both checkouts must contain the same application code and dependencies. Update `~/projects/poker` on the remote machine by pulling a commit or copying the changed files there, then run `npm install` in that checkout.

Start the remote dev server over SSH:

```sh
ssh <ssh-host>
export PATH=/opt/homebrew/bin:$PATH # If Node was installed with Homebrew
cd ~/projects/poker
npm run dev -- --host 127.0.0.1 --port 4173
```

In another terminal, start the local dev server:

```sh
cd ~/projects/poker
npm run dev -- --host 127.0.0.1 --port 4173
```

Then run one or more attempts locally:

```sh
CROSS_NETWORK_APP_URL=http://127.0.0.1:4173/ \
npm run test:cross-network -- <ssh-host> 1
```

The same localhost URL intentionally works on both machines: Chromium loads the local server and the SSH-controlled Firefox loads the remote machine's server. Stop both dev servers after the run. The harness creates its Selenium workspace under remote `/tmp`, copies only `guest.mjs` there, and removes the workspace afterward.

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
