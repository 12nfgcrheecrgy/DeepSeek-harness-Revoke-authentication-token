# dsh-no-token

Serve the DeepSeek Harness Web UI **without the mandatory `?token=` browser
gate**, while keeping Connection's Host/Origin trust fence switched on — and
configure it from **Settings → Plugins** instead of editing YAML.

`dsh web` prints a tokenized URL and refuses every request that does not carry
the signed cookie minted by exchanging that token. This bundle removes the
authentication layer, so `http://127.0.0.1:3080/` just opens.

## What it changes

The gate lives in `@deepseek-ai/dsh-client-connection`. Its live `connection`
service makes two decisions this plugin wraps on the service instance:

| decision | upstream | with this plugin |
|---|---|---|
| `requestRejection(req)` for `/api`, the WebSocket mux, uploads | `401` without the browser cookie, `403` when the Host/Origin fence refuses | `401` → admitted on the bypassed scope; `403` and "admitted" pass through untouched |
| `authorizeIndex(req, res)` for `index.html` | `401`, or a `303` cookie exchange when `?token=` is valid | index is served directly on the bypassed scope |
| `authenticatedUrl(url)` | appends `?token=…` | token stripped on the bypassed scope, so the printed/opened URL carries no secret |

Nothing else is patched: no shipped row is disabled, no other plugin is
replaced. **The Host/Origin fence stays on**, so a page that reaches the port
through DNS rebinding or a cross-site request is still refused with `403` — the
harness can run shell commands, and that fence is what keeps a random web page
out.

## Modes

`mode` is a volatile Config field, so an edit reaches the running process
without a reload.

| mode | effect |
|---|---|
| `loopback` (default) | Only requests whose Host authority is the local machine (`localhost`, `127.0.0.0/8`, `[::1]`) skip the gate. A server bound to a LAN address (`--host 0.0.0.0`) still demands the token from other machines, and the printed LAN URL keeps its token so they can still log in. |
| `all` | Every request that passes the Host/Origin fence skips the gate. Only for a port nothing but you can reach. |
| `off` | Official behaviour: the process token is mandatory again. The wrappers stay installed and become pass-through, so switching in either direction is live. |

## Configure it from the Web UI

The mode page registers into three seats, one per plausible place to look:

| where | seat | what it gives |
|---|---|---|
| **Settings → Built-in plugins → the "No-token access" tab** | `settings.plugins.tab` | the form as a tab in the settings panel, labelled from this bundle's locale |
| **Sidebar Plugins page → `dsh-no-token` → row `no-token` → configure** | `plugins.row.config`, key `dsh-no-token#no-token` | the row gains a configure control; its one-liner comes from the page's `view: 'summary'` render |
| **Sidebar Plugins page → `dsh-no-token` card** | `plugins.bundle.config`, key `dsh-no-token` | the form sits on the bundle's own page, between its description and its rows |

The second seat is the one the slot catalog reserves for "the configuration of a
row a bundle declares" (`<package name>#<row id>`, with the row id as the
patch declares it); the others are the additive tab and bundle seats. None is
`plugins.item`, which belongs to the shipped official settings pages.

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

