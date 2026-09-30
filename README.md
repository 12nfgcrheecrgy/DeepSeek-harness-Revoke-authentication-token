# dsh-no-token

**Open the DeepSeek Harness Web UI without the mandatory `?token=` browser gate**,
while keeping Connection's Host/Origin trust fence switched on — plus one-click LAN
access, password sign-in for phones, tunnel support and a mobile layout, all on one
settings page.

`dsh web` prints a tokenized URL and refuses every request that does not carry the
signed cookie minted by exchanging that token. This bundle removes that
authentication layer for the scope you choose, so `http://127.0.0.1:3080/` just
opens.

> **Read this before installing.** The Harness can run shell commands. `mode: all`
> combined with LAN access means **anyone on the network can operate this machine**,
> and that combination requires an explicit acknowledgement in the UI. The default
> mode is `loopback`: this machine opens without a token, every other machine still
> has to authenticate.

## What it does

| | |
|---|---|
| **Three modes** | `loopback` (default), `all`, `off` — implemented by wrapping the live `connection` service's `requestRejection`, `authorizeIndex` and `authenticatedUrl`. No shipped row is disabled, no other plugin is replaced, and the Host/Origin fence keeps refusing DNS-rebinding and cross-site requests with `403`. |
| **One-click LAN access** | Binds the web server to `0.0.0.0` through the profile config editor, then shows every detected address with its own QR code and login link. |
| **Password sign-in** | Set a password and a phone types it once instead of scanning a token link. A correct password hands off to the *shipped* token exchange, so the same 30-day cookie is minted and no cookie format is reimplemented. Constant-time comparison, delayed failures, 8 attempts per `Host` before a 10-minute lockout. |
| **Tunnels and reverse proxies** | ngrok, a Cloudflare tunnel or a custom DNS name presents a *hostname*, which the shipped fence refuses — the page loads and then sits on "reconnecting" forever. The **Extra trusted hosts** field is this plugin's version of the CLI's `--trusted-host`, and the anti-rebinding markers are re-applied, so listing a name never disables them. |
| **Mobile layout** | The shell ships no narrow-viewport rules of its own, and its frame is a JS-computed grid whose centre column is floored at 400px. The injected stylesheet fixes the frame, turns an expanded sidebar into a drawer, honours safe-area insets (with the `viewport-fit=cover` rewrite that makes them real) and enforces 16px controls so iOS does not zoom on focus. |
| **Fewer dead ends** | A password form for remote visitors instead of the shipped "reopen the URL the terminal printed"; `Cache-Control: no-store` on the document so a stale tab cannot boot against revisions the server no longer serves; an opt-in `#mobile-debug` readout for phone screenshots. |

## Install

From the Harness, install this directory as a bundle. With the plugin manager tool,
point `install_bundle` at the absolute path of the `dsh-no-token` directory:

```
install_bundle   target: <path to this repository>\dsh-no-token
```

Or copy `dsh-no-token/` anywhere and point the profile's package dependencies at it
(`"dsh-no-token": "link:<absolute path>"`, then add `dsh-no-token` to
`dsh.profile.bundles`). Restart once — the host half is loaded per process.

The bundle imports `@deepseek-ai/schemastery` for its Config schema; see
[Dependencies and the workspace layout](dsh-no-token/README.md#dependencies-and-the-workspace-layout)
for why that dependency has to resolve beside the plugin.

## Configure

Everything lives on **one page: Settings → LAN access** — access mode, extra trusted
hosts, the LAN switch, the access password, and the addresses with their QR codes.
The page appears only while the Host serves the row's configuration form.

## Verify

Ten suites, offline and live. `DSH_WEB_PORT` (default `3080`) points the live ones at
any instance.

```powershell
node verify-all.mjs        # the whole acceptance run
node verify-mobile.mjs     # stylesheet + a live drift check against the running shell
$env:DSH_WEB_PORT = '19387'
node verify-boot.mjs       # roster, injected head rows, viewport rewrite
node verify-live.mjs       # gate and fence against the running server
```

| suite | what it proves |
|---|---|
| `verify-manifest.mjs` | the client-module scanner's own resolution: manifest, `./client` export, patch, host exports |
| `verify-no-token.mjs` | gate decisions, the fence, live Config edits, the password gate, the Desktop host's login exchange |
| `verify-client.mjs` | the settings page, rendered and driven |
| `verify-mobile.mjs` | the injected stylesheet, both class-naming schemes, and that every name still exists in the shell |
| `verify-qr.mjs` | the rendered QR codes decode back to their payloads, Reed-Solomon checked |
| `verify-live.mjs` | the running server: gate 6/6, fence, upload path |
| `verify-boot.mjs` | the running process's roster, injected rows and viewport meta |
| `verify-lan.mjs` | one click binds the wildcard, the fence admits the LAN authority, the link mints a cookie |
| `verify-phone.mjs` | read-only: which address a phone can use, and the exact link that works |

## Supported

**0.1.7-rc.2 through 0.2.0-rc.2**, on the `web` platform — and the Desktop app, whose
profile serves the same browser surface. Verified live on 0.2.0-rc.2: gate 6/6,
roster 19/19, and the stylesheet's 20 class names against the shell's 913.

## Layout

```
dsh-no-token/          the installable bundle
  index.js             host half: gate patch, LAN switch, password form, injected UI
  client.js            browser half: the settings page, mobile fallback, readout
  cordis.patch.yml     the one row the bundle contributes
  locale/{en,zh}.json  the card metadata
tools/
  build-mobile-css.mjs regenerates the mobile layer from the running shell
verify-*.mjs           the suites
LICENSE                MIT
```

## Documentation

- **[Bundle README](dsh-no-token/README.md)** — the full story: what each patch
  touches, every control, the tunnel case, the security model, and the five
  maintenance rules this plugin learned the hard way. A Chinese translation follows
  the English text in the same file.

## License

MIT — see [LICENSE](LICENSE).
