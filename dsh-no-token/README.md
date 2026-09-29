# dsh-no-token

Serve the DeepSeek Harness Web UI **without the mandatory `?token=` browser
gate**, while keeping Connection's Host/Origin trust fence switched on — and
configure everything from **Settings → LAN access** instead of editing YAML.

`dsh web` prints a tokenized URL and refuses every request that does not carry
the signed cookie minted by exchanging that token. This bundle removes the
authentication layer, so `http://127.0.0.1:3080/` just opens.

What it adds on top of that:

- **one switch** for LAN access, with a QR code per detected address;
- an optional **password** for phones, exchanged for the shipped 30-day cookie;
- **extra trusted hosts** for ngrok, Cloudflare tunnels, reverse proxies and
  private DNS names — without which the page loads and then sits on
  "reconnecting" forever;
- a **mobile layout** for a shell that ships no narrow-viewport rules of its own,
  including safe-area handling and an opt-in `#mobile-debug` readout.

## What it changes

The gate lives in `@deepseek-ai/dsh-client-connection`. Its live `connection`
service makes two decisions this plugin wraps on the service instance:

| decision | upstream | with this plugin |
|---|---|---|
| `requestRejection(req)` for `/api`, the WebSocket mux, uploads | `401` without the browser cookie, `403` when the Host/Origin fence refuses | `401` → admitted on the bypassed scope; `403` and "admitted" pass through untouched |
| `authorizeIndex(req, res)` for `index.html` | `401`, or a `303` cookie exchange when `?token=` is valid | index is served directly on the bypassed scope |
| `authorizeIndex(req, res)` for `index.html` | `401`, or a `303` cookie exchange when `?token=` is valid | index is served directly on the bypassed scope, and the response is marked `Cache-Control: no-store` |
| `authenticatedUrl(url)` | appends `?token=…` | token stripped on the bypassed scope, so the printed/opened URL carries no secret |

Nothing else is patched: no shipped row is disabled, no other plugin is
replaced. **The Host/Origin fence stays on**, so a page that reaches the port
through DNS rebinding or a cross-site request is still refused with `403` — the
harness can run shell commands, and that fence is what keeps a random web page
out.

One addition rides that same wrapper: **every `index.html` response is marked
`Cache-Control: no-store`**. The shipped static server sets no cache headers at
all, and each client module is named by a content revision — a document cached
from an earlier generation points at revisions the server no longer has, every
module batch then answers `404`, and the app never mounts: a **blank page**. A
hard reload fixes it once, but Chrome reuses a stale document where Firefox
revalidates, so the header is what stops it happening at all.

## Modes

`mode` is a volatile Config field, so an edit reaches the running process
without a reload.

| mode | effect |
|---|---|
| `loopback` (default) | Only requests whose Host authority is the local machine (`localhost`, `127.0.0.0/8`, `[::1]`) skip the gate. A server bound to a LAN address (`--host 0.0.0.0`) still demands the token from other machines, and the printed LAN URL keeps its token so they can still log in. |
| `all` | Every request that passes the Host/Origin fence skips the gate. Only for a port nothing but you can reach. |
| `off` | Official behaviour: the process token is mandatory again. The wrappers stay installed and become pass-through, so switching in either direction is live. |

## Configure it from the Web UI

Everything lives on **one page: Settings → LAN access** (`settings.section`, id
`no-token-lan`). It holds the access mode, the extra trusted hosts, the LAN
switch, the access password, and the addresses with their QR codes.

Earlier versions also rendered the mode form into `settings.plugins.tab`,
`plugins.row.config` and `plugins.bundle.config`, because each is a plausible
place to look for a plugin's configuration. That was a mistake in practice: the
same switch appeared in three extra places, so changing it in one and looking in
another read as "the setting did not stick". The seats are gone; the row's
controller is still resolved (that is what the mode block drives), and the
browser half now claims exactly two seats — this section and the frame-wide
`shell.overlay` layer used by the stylesheet and the readout.

Values come from the shared `configForms` service of
`@deepseek-ai/dsh-client-ui-settings`, so the page inherits revision fencing,
write recovery, and the live Host update; a save lands in the active profile's
Cordis patch (`~/.dsh/profiles/web/cordis.patch.yml`) and applies immediately.
Editing `client.js` needs no restart: the module table recomposes and the served
revision changes, so a page refresh picks the new bytes up.

The page only appears while the Host serves the entry's form, so a profile with
the row disabled shows no trace of it. `DSH_NO_TOKEN_MODE` sets the default at
boot when it names a mode; a save from the page writes a profile-layer override
for the entry, and that override — not the environment — is then the value in
force. Reset returns to the bundle default, environment expression included.

### Tunnels, reverse proxies, and the "reconnecting" loop

The trust fence accepts a request only when its `Host` is loopback or one of the
authorities the deployment serves — and those derived authorities are **IP
literals**, deliberately: DNS rebinding needs an attacker-controlled name, while
an IP-literal Host is safe on any port.

A tunnel (ngrok, a Cloudflare tunnel, a reverse proxy, a private DNS name) is a
hostname. Serve through one and the fence answers **403 to every `/api` request**,
which leaves the page itself loading normally while the API bridge and the event
stream are dead: the UI sits on "reconnecting" forever. The shipped answer is the
CLI's `--trusted-host`, which a plugin cannot add to someone's launch line.

So **Extra trusted hosts** on the LAN page is this plugin's version of it: one
authority per line, written durably into this row's profile config, and honoured
by the gate patch. Matching mirrors `isTrustedAuthority` — an entry with a port
matches that exact authority, one without matches the hostname on any port.

Listing a name does **not** disable the anti-rebinding defence: both browser
markers the shipped fence checks are re-applied, so a cross-site request
(`Sec-Fetch-Site: cross-site`) and a request whose `Origin` contradicts its `Host`
are still refused.

## LAN access: one click, then scan

**Settings → LAN access** is its own first-class entry in the settings panel
(`settings.section`, id `no-token-lan`, order 25 — beside General, Models,
Built-in plugins and Agent presets), separate from the mode page above.

One button there binds every interface (`webserver.host = 0.0.0.0`), after which
the page lists each detected LAN IPv4 address with its login link, a QR code, and
a copy button; the same button turns it back off. A phone on the same Wi-Fi scans
the code and lands in the GUI already signed in.

Mechanism, and why it is the sanctioned one:

- The shipped CLI **refuses** `--host 0.0.0.0` on purpose
  (`dsh-web-app/lib/startup.js`: "it would expose remote code execution to the
  network"), while the web server's Config accepts exactly two binds —
  `127.0.0.1` and `0.0.0.0` (`dsh-host-webserver/lib/index.js`). So the switch
  writes the *web server row's* config through the profile config editor
  (`configEditor.edit`), which is the same persistence path the settings service
  uses. It restates the inherited layer, so `port` and `compression` keep their
  `!!js` expressions.
- That write reloads the row, which rebinds and — because `web-runtime` injects
  `webServer` — refreshes `resolveLanTrust`, so the LAN addresses join the
  `/api` trust fence. The page may disconnect for a second while this happens;
  its poll rides that out.
- **No authentication is relaxed.** A phone still signs in through the official
  `?token=` exchange (the link the page shows *is* tokenized), so `mode:
  loopback` stays safe. When the mode is `all`, the button requires an explicit
  acknowledgement first, because the harness can run shell commands.
- The switch survives a restart (it is a profile patch), and the page always
  shows the current state with the one-click way back.

Not done on purpose: no patched shipped rows, no bypass of the CLI guard, no
second listener or reverse proxy (the web server already supports the wildcard
bind), and no automatic Windows Firewall change — the page offers the exact
elevated command to copy instead. If the PC's address changes later, the fence
snapshot needs a reload; the page marks addresses it cannot vouch for.

The QR encoder is written into `client.js` (fixed version 6, EC level M, byte
mode) because the module table offers only baseline libraries and a plugin must
not depend on a Harness Client package. `verify-qr.mjs` decodes the rendered SVG
back to its payload, checks the format information arithmetically and verifies
every Reed-Solomon block, so the code is proven scannable rather than assumed.

### A password instead of the token

The token is a one-time credential, but scanning a code is not always what a
phone wants. Set a password instead and the bare address serves a sign-in form:

```
设置 → 局域网访问 → 访问密码 → 输入 → 保存密码
```

or skip the UI and hand it to the process environment:

```powershell
$env:DSH_LAN_PASSWORD = 'your-password'; dsh web
```

- The password lives in the harness credential store under the reference
  `DSH_LAN_PASSWORD`, so it can come from the environment, the provider store, or
  a `.env` file — no config file carries the secret. The settings page only ever
  learns *whether* one is set, never its value.
- A correct password **redirects to the shipped token exchange** (`/?token=…`),
  so Connection itself mints the same 30-day cookie; no cookie format is
  reimplemented here.
- The form is an ordinary web-server route (`/no-token/login`), not an `/api`
  route: that prefix is admitted only *after* authentication, which is exactly
  what a visitor does not have yet.
- Failures are compared in constant time, delayed, and locked out after 8
  attempts per authority for 10 minutes. The `Host` header is escaped before it
  reaches the page, because the visitor supplies it.
- `mode: all` remains the no-authentication option; the password is the middle
  ground — a phone types it once, and the harness is still not open to whoever
  else is on the network.

### Mobile layout

The shipped shell contains no narrow-viewport rules at all (its only media query
is `prefers-reduced-motion`), and its frame is a **JS-computed grid**. From
`dsh-client-ui-layout/lib/client.js`:

```js
computeColumns(viewport, sidebar, rightbar, collapsedWidth = 56) {
  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, 264, 420);
  const available = viewport - s - 400;
  const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
// and the columns are inline styles:
gridTemplateColumns: `${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : 400}px, 1fr) minmax(0px, ${rightbarMax}px)`
```

So on a phone an **expanded sidebar is a fixed 264–420px column** (≈113px of
conversation left on a 390px screen) and any tracked right pane floors the centre
at 400px. The stylesheet therefore changes **only the template** and pins the three
items to their tracks:

- `grid-template-columns: 56px minmax(0, 1fr) 0` while collapsed (`56` is the
  shell's own `collapsedWidth`; a macOS desktop sets it to `0`), and
  `0 minmax(0, 1fr) 0` while expanded, where the sidebar becomes an absolutely
  positioned **drawer** (`min(86vw, 320px)` plus a scrim) — the official app's
  shape. `SidebarRoot` freezes its content at the last expanded width through an
  inline style, so the drawer caps that child too.
- `grid-column` pins on `_sidebarCol` / `_centerCol` / `_rightbarCol`: necessary,
  because an absolutely positioned sidebar would otherwise let auto-placement slide
  the centre into the first track.
- The right column stays a **zero-width track**, which is what its occupant
  expects: per the layout source the panel is drawn anchored to the frame's right
  edge and only uses the track to ask the centre for room (`overflow: visible`), so
  a right pane covers the conversation instead of squeezing it. `overlayLayer`,
  `leadingSeat` and `handle` are already `position: absolute` and stay out of flow,
  which is why the shell's grid is kept rather than replaced with flex.
- Conversation gutters drop to 12px, the greeting to 22px, the composer gains
  `padding-bottom: max(8px, env(safe-area-inset-bottom))`, controls are forced to
  16px so iOS does not zoom on focus, tap targets are enlarged, overlays fill the
  screen, and wide content scrolls in place.

Every rule sits in one of exactly two top-level blocks, which `verify-mobile.mjs`
enforces, so a desktop window matches nothing in width or in pointer:

| Block | Scope | Why |
|---|---|---|
| `@media (max-width: 820px)` | phones in portrait | the shell's JS-computed grid is what breaks there, and nothing wider needs the drawer |
| `@media (pointer: coarse) and (min-width: 821px) and (max-width: 1023.98px)` | a phone held sideways (≈844–932px), and small tablets | the shell's narrow mode starts at `SIDEBAR_AUTO_COLLAPSE = 1024` in `dsh-client-ui-layout`, so that band is *already* narrow-mode while 820px no longer matches. Only device-level rules live here — iOS's focus zoom, tap targets, the landscape insets — because at those widths the shell's own narrow layout (a 56px rail, its own `narrowExpanded` drawer) is the right one, and restating the template would reshape a 900px desktop window too. `pointer: coarse` is the **primary** pointer, so a mouse-driven window never matches. |

### Safe areas

`env(safe-area-inset-*)` is **0 for the whole document** until the served viewport
meta carries `viewport-fit=cover`. The shipped document does not: `dist/index.html`
ships `content="width=device-width, initial-scale=1"`, and no shipped CSS mentions
an inset at all — so before this plugin the composer sat on the home indicator and
every inset rule would have been dead code. The Host rewrites that meta through
**`webServer.tapIndex`** (applied by `renderIndex` after the structured rows, on
every index response — the document a phone really loads):

```
width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content
```

- `viewport-fit=cover` is what makes the inset rules real. The frame states
  `box-sizing: border-box` alongside them (the shell's frame is content-box — only
  its Windows-titlebar variant states otherwise, so the padding would otherwise
  overflow the 100% height), and its `padding-top` carries **no `!important`**: the
  shell's own `[data-windows-titlebar] .frame { padding-top: var(--dsh-windows-titlebar-height) }`
  is more specific and must keep winning on a Windows desktop, where every inset
  resolves to 0. `verify-mobile.mjs` guards that with a test.
- The expanded drawer states its own top and leading insets: an absolutely
  positioned child is placed against the frame's *padding box*, so the frame's own
  padding cannot reach it. It keeps `bottom: 0` so the scrim still covers the
  gesture bar, and pads its content off the bar instead.
- `interactive-widget=resizes-content` asks Chrome/Android to shrink the layout
  viewport for the on-screen keyboard instead of overlaying it, so the composer
  stays visible. Browsers that do not know the key ignore it; deleting that one
  token falls back to the previous behaviour.
- The meta is edited, never duplicated — two viewport metas would leave the winner
  to the browser — the transform is idempotent, and a document with no viewport meta
  at all gets the shipped base keys plus these.

Every selector is a class name that really exists in the shipped client bundles —
`_frame`, `_sidebarCol`, `_centerCol`, `_rightbarCol` (from
`dsh-client-ui-layout`), and the conversation's `_viewArea_`, `_scrollBody_`,
`_composerSeat_`, `_headline_`, `_iconButton_`, `_backdrop_`, … (these match the
semantic part of a generated name, so a rebuild that rehashes the prefix keeps them
working).

**Two delivery paths, one stylesheet.** The Host pushes it into the document head
through the `webserver/index-inject` table — present at first paint, and immune to
the missing cache headers on the served document (`frontend-static` calls
`webServer.renderIndex` on every index response). The browser half carries the
same text as well, because a client-module change reaches a phone on its next
reload while a Host change needs a restart: it renders the stylesheet **only while
the Host's copy is absent**, detected through the sentinel comment
`/* dsh-no-token/mobile */`. `verify-mobile.mjs` asserts the two copies are
**byte-identical**, so they cannot drift apart.

Two things make the layer **verifiable from a phone** rather than by inspection:

| Mechanism | What it does |
|---|---|
| `#mobile-debug` in the URL | The injected script shows `innerWidth`, `devicePixelRatio`, whether the width query matched, whether the pointer is coarse, whether the document's viewport meta carries `viewport-fit=cover`, the four **resolved safe-area insets**, and each frame column's measured width. The insets are the point: they are `0px/0px/0px/0px` in every browser until the meta rewrite lands, so one glance at a phone screenshot says whether this layer is live and edge-to-edge. Without the fragment it is completely silent. |
| Cache tag on the links | Every LAN link and QR code carries `&v=<8 hex>`, a digest of the stylesheet **and** of the viewport keys. It only affects the cache key — the token exchange ignores extra query parameters — so a phone that would reuse a cached document fetches a fresh one, and the tag changes whenever either the layout or the meta does. That matters because a cached document with the new stylesheet but the old meta would leave every safe-area rule inert. |

**Not done on purpose**: the left icon rail is not hidden. It also carries
navigation (new session, search, settings), and the conversation header has no
hamburger of its own — hiding the rail would leave no way to reach the session
list. The right pane keeps the shell's own `rightbarFullscreen` behaviour.

**Both the rows and the viewport rewrite come from the Host half**, so a `dsh web`
process started before them serves a document with neither, however current the
file on disk is — `node verify-boot.mjs` reports exactly that pair as FAIL, next
to the served stylesheet size it can compare. The browser half's fallback
stylesheet covers a stale *cache*, not a stale *process*: restart `dsh web` after
changing `index.js`, then reload the phone.


Outside the UI, edit this bundle's patch or the profile patch:

```yaml
- insert:
    - id: no-token
      name: dsh-no-token
      config:
        mode: !!js "['loopback', 'all', 'off'].includes(process.env.DSH_NO_TOKEN_MODE) ? process.env.DSH_NO_TOKEN_MODE : 'loopback'"
```

## Install

Installed as a profile bundle (`plugin_manager` → `install_bundle` with this
directory, or `dsh plugin --profile web add <this directory>`). The profile
records it as `link:`, so this working copy **is** the installed plugin: an edit
needs a reload, and deleting the directory breaks the row.

Installing changed `index.js` (new exports) or adding a browser half requires
**restarting `dsh web` once**: one JavaScript module generation is loaded per
process, so a process started earlier keeps the old Host code and serves no
`/plugins/dsh-no-token/client.js`. After the restart, reload the page.

### Dependencies and the workspace layout

The Config schema needs `@deepseek-ai/schemastery` (declared in
`package.json`). A `link:` install does not install the linked package's own
dependencies, and Node resolves imports from the real path of the module — this
directory — so the dependency and its own dependency live beside the plugin:

```
deepseekHrnessNoToken/node_modules/@deepseek-ai/schemastery
deepseekHrnessNoToken/node_modules/@deepseek-ai/cosmokit
```

They are copies of the Harness's own `@deepseek-ai/schemastery@3.18.4`
(`~/.dsh`-independent), which keeps schema semantics identical to the running
Loader. Doing it by package manager instead — `pnpm add
@deepseek-ai/schemastery` in this directory — produces the same layout.

## Verify

```powershell
node verify-all.mjs        # every suite below, one verdict (the acceptance command)
node verify-manifest.mjs   # the scanner's own resolution: manifest, ./client export, patch, host exports
node verify-no-token.mjs   # host decisions: gate, fence, live Config edits, password gate, teardown, LAN route
node verify-client.mjs     # browser half: mode page and the one-click LAN page, rendered and driven
node verify-mobile.mjs     # the injected mobile layer: rows, viewport rewrite, desktop inertness, byte-identical copies
node verify-qr.mjs         # the rendered codes decode back to their payloads, RS blocks verified
node verify-live.mjs       # the running server: 6/6 gate and fence checks
node verify-boot.mjs       # the running process's module table carries the browser half, its seats and the head rows
node verify-lan.mjs        # live: one click binds the wildcard, the fence admits the LAN authority,
                           # the shown link mints a cookie, then the bind goes back (--keep-lan to stay on)
node verify-phone.mjs      # read-only: which address a phone can use, and the exact link that works
```

`verify-boot.mjs` reads `__DSH_BOOT__` from the served page and follows the URL
the manifest advertises for `dsh-no-token`. The served chunk URL is matched
exactly, revision included, so a bare `/plugins/dsh-no-token/client.js` is never
a valid URL — the manifest entry is the only reliable address. This is the one
script that keeps failing until the restart described above has happened.

## Why not `dsh-shutup`

`dsh-shutup` is a third-party bundle with the same goal. In this profile it
cannot load: its `startup.js` row imports `commander` and
`@deepseek-ai/dsh-cmdline`, which are not installed (`pnpm add dsh-shutup`
failed, leaving only an unpacked directory in `node_modules`), and it also
disables the shipped `web-startup` row to re-enable `--host 0.0.0.0`. This
plugin needs none of that: it keeps the shipped startup row and touches only the
gate.

## Repository layout

```
dsh-no-token/          the installable bundle
  index.js             host half: gate patch, LAN switch, password form, injected UI
  client.js            browser half: mode page, LAN page, mobile fallback, readout
  cordis.patch.yml     the one row the bundle contributes
  locale/{en,zh}.json  the card metadata
verify-*.mjs           the suites, run from this directory
LICENSE                MIT
```

`node_modules/` is not committed: it holds copies of two packages that ship with
the Harness (see above), and `.gitignore` documents why.

## Security model

- The Host/Origin trust fence is never touched. Only the browser-token gate is
  weakened, and only for the authorities the mode selects.
- `loopback` (the default) leaves a LAN visitor required to authenticate; the
  password form only ever redirects to the *shipped* token exchange, so no cookie
  format is reimplemented.
- Password comparison is constant-time over digests, failures are delayed, and
  each `Host` is locked out after 8 failures for 10 minutes (bounded to 64 tracked
  authorities, because that key is chosen by the visitor).
- `all` is the only mode that removes authentication for the network, and the page
  requires an explicit acknowledgement before it can be combined with LAN access.
  The Harness can run shell commands: treat that combination as handing the
  machine to everyone on the network.

## License

MIT — see [LICENSE](LICENSE).

## Version history

| version | what changed |
|---|---|
| **1.2.0** | Everything on one page (`settings.section`) instead of four seats; **extra trusted hosts** for tunnels and reverse proxies; **password sign-in**; a host-injected mobile stylesheet with a browser fallback, a `viewport-fit=cover` rewrite and an opt-in `#mobile-debug` readout; landscape-phone device rules; a revision watcher so an edited UI reaches a phone by itself. |
| 1.1.0 | The one-click LAN switch, the LAN/loopback control route, per-mode wrappers and the QR encoder. |
| 1.0.0 | The gate wrappers themselves: three modes over `requestRejection`, `authorizeIndex` and `authenticatedUrl`. |

## Notes for maintainers

Three rules this plugin learned the hard way. Each one has a suite that fails if
it is broken again.

1. **A config write must keep the rest of the row it edits.**
   `configEditor.edit(entry, (current, inherited) => …)` hands over the row's
   *existing override* first and the inherited layer second. Deriving the new
   config from `inherited` alone silently discards every other value saved on that
   row: saving the trusted hosts once reset the access mode, which reads as the
   page switching itself back to "this machine only".
2. **A browser-half change needs a page reload; a host-half change needs a restart.**
   The client module roster is rebuilt per request and its revision is a content
   hash, so edited `client.js` bytes arrive on a reload — but `index.js` is loaded
   once per process, so a Host feature is simply absent until `dsh web` restarts.
   That asymmetry is why the UI reports a Host half that predates a field as
   "restart dsh web" rather than forwarding its `400`.
3. **The stylesheet exists twice, byte-identical.** The Host injects it into the
   document head (first paint, cache-proof, reaches a phone even through a cached
   document) and the browser half carries the same text so a phone updates without
   a Host restart. The browser copy stands down when the Host's is present,
   detected through the `dsh-no-token/mobile` sentinel, and `verify-mobile.mjs`
   fails if the two copies ever differ by a byte.

## 中文说明

---

## 一、核心目标

**在不关闭 Host/Origin 信任围栏的前提下，去掉 `?token=` 强制门禁**，并且所有配置都可以从 **设置 → 局域网访问** 完成，而不是手改 YAML。

`dsh web` 原本会打印一个带 token 的 URL，任何没有携带签名 cookie 的请求都会被拒绝。这个 bundle 把认证层移除，让 `http://127.0.0.1:3080/` 直接打开。

在此之上它另外提供：**一键局域网开关（每个地址配二维码）**、**可选的访问密码**（换成官方的 30 天 cookie）、**额外可信主机**（ngrok / Cloudflare 隧道 / 反向代理 / 自定义域名 —— 没有这一项，页面能打开但会一直「重新连接中」）、以及**移动端布局**（外壳本身没有任何窄屏规则）。

---

## 二、它改了什么

门禁逻辑位于 `@deepseek-ai/dsh-client-connection`。插件在 service 实例上包裹了三个决策点：

| 决策点 | 上游行为 | 插件行为 |
|---|---|---|
| `requestRejection(req)`（`/api`、WebSocket mux、上传） | 无 cookie → `401`；Host/Origin 围栏拒绝 → `403` | bypassed scope 上 `401` → 放行；`403` 和「已放行」原样透传 |
| `authorizeIndex(req, res)`（`index.html`） | `401`，或 `?token=` 有效时 `303` 换 cookie | bypassed scope 上直接返回 index |
| `authenticatedUrl(url)` | 追加 `?token=…` | bypassed scope 上剥离 token，打印/打开的 URL 不含 secret |

**其他一律不动**：不禁用任何 shipped row，不替换其他插件。**Host/Origin 围栏保持开启**，DNS rebinding 或跨站请求仍会被 `403` 拒绝——因为 harness 能跑 shell 命令，这道围栏是防止随机网页闯入的关键。

---

## 三、三种模式

`mode` 是 volatile Config 字段，编辑后无需 reload 即可生效。

| 模式 | 效果 |
|---|---|
| `loopback`（默认） | 只有 Host authority 是本机（`localhost`、`127.0.0.0/8`、`[::1]`）的请求跳过门禁。绑定到 LAN 地址（`--host 0.0.0.0`）时，其他机器仍需 token，打印的 LAN URL 也保留 token。 |
| `all` | 所有通过 Host/Origin 围栏的请求都跳过门禁。仅适用于只有你能访问的端口。 |
| `off` | 官方行为：进程 token 重新成为必需。wrapper 仍安装但变为透传，切换是实时的。 |

---

## 四、从 Web UI 配置

全部集中在**一个页面：设置 → 局域网访问**（`settings.section`，id `no-token-lan`）：访问模式、额外可信主机、局域网开关、访问密码、地址列表与二维码。

早期版本还把模式表单同时渲染进 `settings.plugins.tab`、`plugins.row.config`、`plugins.bundle.config` 三个 seat。这在实际使用中是错的：同一个开关出现在四个地方，在一处改完去另一处看，就会以为"设置没生效"。这三个 seat 已全部移除；该行的 controller 仍然解析（模式区块要驱动它），客户端现在只占两个座位 —— 这个设置页，以及样式与读数用的 `shell.overlay`。

值来自 `@deepseek-ai/dsh-client-ui-settings` 的共享 `configForms` service，继承 revision fencing、写恢复和 live Host 更新；保存写入活动 profile 的 Cordis patch（`~/.dsh/profiles/web/cordis.patch.yml`）并立即生效。

编辑 `client.js` 无需重启：模块表重组，served revision 变化，刷新页面即可拿到新字节。

### 隧道 / 反向代理 与「一直重新连接中」

信任围栏只接受 `Host` 为回环或本部署所服务 authority 的请求，而**派生出来的 authority 一律是 IP 字面量**（这是刻意的：DNS 重绑定需要攻击者可控的域名，而 IP 字面量的 Host 在任何端口都安全）。

ngrok、Cloudflare 隧道、反向代理、自定义 DNS 名给的是**域名**。用它访问时，围栏会对**每一条 `/api` 请求**回 `403` —— 页面本身照常加载，但 API 桥和事件通道全死，界面就一直停在「重新连接中」。官方对此的答案是命令行 `--trusted-host`，而插件没法往你的启动命令里加参数。

所以**「额外可信主机」**就是本插件版的 `--trusted-host`：每行一个 authority，持久化写进本行的 profile 配置，由门禁补丁生效；匹配规则照抄 `isTrustedAuthority` —— 带端口的条目匹配该精确 authority，不带的匹配任意端口。

列出域名**不会**削弱防重绑定：围栏检查的两个浏览器标记原样重放，跨站请求（`Sec-Fetch-Site: cross-site`）与 `Origin` 和 `Host` 不符的请求**仍然被拒**。

---

## 五、LAN 访问：一键 + 扫码

**Settings → LAN access** 是设置面板中独立的一级入口（`settings.section`，id `no-token-lan`，order 25）。

- 一个按钮把所有接口绑定到 `webserver.host = 0.0.0.0`
- 页面列出每个检测到的 LAN IPv4 地址、登录链接、二维码和复制按钮
- 同一按钮可切回关闭
- 手机在同一 Wi-Fi 下扫码即可登录 GUI

**机制（为什么是合规做法）**：

- shipped CLI 故意**拒绝** `--host 0.0.0.0`（`dsh-web-app/lib/startup.js` 说这会向网络暴露远程代码执行），而 web server 的 Config 只接受两种绑定：`127.0.0.1` 和 `0.0.0.0`（`dsh-host-webserver/lib/index.js`）。所以开关通过 profile config editor（`configEditor.edit`）写 **web server row 的配置**，这是 settings service 使用的同一持久化路径。
- 这次写入会 reload 该 row，重新绑定，并且因为 `web-runtime` 注入了 `webServer`，会刷新 `resolveLanTrust`，让 LAN 地址加入 `/api` 信任围栏。页面可能断开一秒，其 poll 会挺过去。
- **没有放松认证**。手机仍通过官方 `?token=` 交换登录（页面显示的链接**就是**带 token 的），所以 `mode: loopback` 保持安全。当 mode 为 `all` 时，按钮要求先显式确认。
- 开关在重启后仍保留（它是 profile patch），页面始终显示当前状态和一键恢复方式。

**故意不做的事**：不 patch shipped rows，不绕过 CLI guard，不加第二个 listener 或反向代理，不自动改 Windows 防火墙——页面提供需要提权的命令让用户复制。

---

## 六、用密码代替 token

token 是一次性凭据，但扫码不一定适合手机。设置密码后，裸地址会提供一个登录表单：

```
设置 → 局域网访问 → 访问密码 → 输入 → 保存密码
```

或跳过 UI，直接给进程环境：

```powershell
$env:DSH_LAN_PASSWORD = 'your-password'; dsh web
```

- 密码存放在 harness credential store，引用名 `DSH_LAN_PASSWORD`，可来自环境、provider store 或 `.env` 文件——没有配置文件携带 secret。设置页只知道**是否**设置了密码，永远不知道值。
- 正确密码会**重定向到 shipped token exchange**（`/?token=…`），由 Connection 自己铸造同样的 30 天 cookie；不重新实现任何 cookie 格式。
- 表单是普通 web-server 路由（`/no-token/login`），不是 `/api` 路由——该前缀只有在认证**之后**才被允许，而这正是访客还没有的东西。
- 失败比较是常数时间的，有延迟，每个 authority 8 次失败后锁定 10 分钟。`Host` header 在进入页面前被转义。
- `mode: all` 仍是无认证选项；密码是中间地带。

---

## 七、移动端布局

shipped shell 完全没有窄视口规则，其框架是 **JS 计算的 grid**。手机上展开的 sidebar 是固定 264–420px 列（390px 屏幕上约剩 113px 对话区），任何被追踪的右侧面板都会把中心压到 400px。

样式表**只改 template**，并把三个 item 钉到各自轨道：

- 折叠时 `grid-template-columns: 56px minmax(0, 1fr) 0`；展开时 `0 minmax(0, 1fr) 0`，sidebar 变成绝对定位的 **drawer**（`min(86vw, 320px)` + scrim）。
- `grid-column` 钉在 `_sidebarCol` / `_centerCol` / `_rightbarCol` 上。
- 右列保持 **zero-width track**，右侧面板覆盖对话而非挤压它。
- 对话 gutter 降到 12px，greeting 22px，composer 增加 `padding-bottom: max(8px, env(safe-area-inset-bottom))`，控件强制 16px 防止 iOS 聚焦缩放。

所有规则只落在两个顶层块之一（`verify-mobile.mjs` 强制）：

| 块 | 范围 | 原因 |
|---|---|---|
| `@media (max-width: 820px)` | 竖屏手机 | shell 的 JS grid 在这里出问题 |
| `@media (pointer: coarse) and (min-width: 821px) and (max-width: 1023.98px)` | 横屏手机、小平板 | shell 的 narrow mode 从 1024 开始，这个区间已是 narrow-mode；只放设备级规则，不重述 template |

---

## 八、Safe areas

`env(safe-area-inset-*)` 在整个文档中为 **0**，直到 served viewport meta 带上 `viewport-fit=cover`。shipped 文档不带。Host 通过 **`webServer.tapIndex`** 重写该 meta：

```
width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content
```

- `viewport-fit=cover` 让 inset 规则真正生效。
- frame 声明 `box-sizing: border-box`，`padding-top` **不带 `!important`**，让 Windows titlebar 变体保持优先。
- 展开的 drawer 声明自己的 top/leading inset，保持 `bottom: 0` 让 scrim 覆盖手势条。
- `interactive-widget=resizes-content` 让 Chrome/Android 为软键盘缩小布局视口。
- meta 是编辑而非重复，转换幂等。

**两条交付路径，一份样式表**：Host 通过 `webserver/index-inject` 表推入 head；浏览器半边也携带相同文本，因为 client-module 变更在下次 reload 到达手机，而 Host 变更需要重启。`verify-mobile.mjs` 断言两份副本**逐字节相同**。

---

## 九、安全模型

- Host/Origin 信任围栏**永不触碰**。只削弱浏览器 token 门禁，且只在模式选定的 authority 上。
- `loopback`（默认）让 LAN 访客仍需认证；密码表单只重定向到 **shipped** token exchange。
- 密码比较基于 digest 的常数时间，失败有延迟，每个 `Host` 8 次失败锁 10 分钟（上限 64 个追踪的 authority）。
- `all` 是唯一移除网络认证的模式，页面要求显式确认才能与 LAN 访问组合。**Harness 能跑 shell 命令：把这种组合视为把机器交给网络上的所有人。**

---

## 十、安装与验证

**安装**：作为 profile bundle 安装（`plugin_manager` → `install_bundle`，或 `dsh plugin --profile web add <this directory>`）。profile 记录为 `link:`，所以这个工作副本**就是**已安装插件。

安装改动了 `index.js`（新 exports）或新增浏览器半边，需要**重启 `dsh web` 一次**：每个进程加载一代 JavaScript 模块。

**依赖**：Config schema 需要 `@deepseek-ai/schemastery`。`link:` 安装不会安装链接包自己的依赖，所以依赖及其自身依赖放在插件旁边：

```
deepseekHrnessNoToken/node_modules/@deepseek-ai/schemastery
deepseekHrnessNoToken/node_modules/@deepseek-ai/cosmokit
```

**验证命令**：

```powershell
node verify-all.mjs        # 所有套件，一个结论（验收命令）
node verify-manifest.mjs   # 扫描器自身的解析
node verify-no-token.mjs   # host 决策：门禁、围栏、live Config 编辑、密码门、teardown、LAN 路由
node verify-client.mjs     # 浏览器半边：模式页和一键 LAN 页
node verify-mobile.mjs     # 注入的移动层：rows、viewport 重写、桌面惰性、逐字节相同副本
node verify-qr.mjs         # 渲染的码解码回 payload，验证 RS 块
node verify-live.mjs       # 运行中的服务器：6/6 门禁和围栏检查
node verify-boot.mjs       # 运行进程的模块表携带浏览器半边、其 seats 和 head rows
node verify-lan.mjs        # live：一键绑定 wildcard，围栏放行 LAN authority，链接铸造 cookie，然后绑回
node verify-phone.mjs      # 只读：手机能用哪个地址，以及确切可用的链接
```

---

## 十一、为什么不用 `dsh-shutup`

`dsh-shutup` 是同一目标的第三方 bundle，但在这个 profile 中无法加载：它的 `startup.js` row 导入 `commander` 和 `@deepseek-ai/dsh-cmdline`，这些未安装，而且它禁用了 shipped `web-startup` row 来重新启用 `--host 0.0.0.0`。本插件不需要这些：它保留 shipped startup row，只触碰门禁。

---

## 十二、仓库布局

```
dsh-no-token/          the installable bundle
  index.js             host half: gate patch, LAN switch, password form, injected UI
  client.js            browser half: mode page, LAN page, mobile fallback, readout
  cordis.patch.yml     the one row the bundle contributes
  locale/{en,zh}.json  the card metadata
verify-*.mjs           the suites, run from this directory
LICENSE                MIT
```

`node_modules/` 不提交：它持有两个随 Harness 一起发布的包的副本。

---
## 许可证

MIT- 见[LICENSE](LICENSE).