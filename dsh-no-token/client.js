/**
 * dsh-no-token — browser half.
 *
 * Renders the configuration of this bundle's own row inside the Plugins
 * settings page, so `mode` is changeable without editing YAML.
 *
 * Placement follows the slot catalog: `plugins.row.config` is the seat for "the
 * configuration of one row a bundle declares", keyed by `<package name>#<row
 * id>`, and the Plugins page gives that row a configure control whose page body
 * is this contribution. (`plugins.item` belongs to the shipped official
 * settings pages; `plugins.bundle.config` is for a whole bundle.)
 *
 * Values come from the shared `configForms` service of
 * `@deepseek-ai/dsh-client-ui-settings`, so this page inherits revision fencing,
 * write recovery, and the live Host update instead of talking to the settings
 * transport itself. The controls are written here rather than imported from
 * `@deepseek-ai/dsh-client-ui-primitives`: a plain-JavaScript plugin has no
 * type check, and a throwing component blanks the whole slot entry. Styling
 * uses only `--dsw-alias-*` theme tokens, so light and dark both work.
 */
window.__ModuleLoader__.load({
  id: 'dsh-no-token',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this page. */
    const NS = 'settings.noToken'
    /**
     * Profile entry ids this page may be bound to. A settings namespace is the
     * Loader entry id, which a nested include layer prefixes — this bundle's row
     * is inserted by the plugin manager's own include layer, so both the row id
     * the patch declares and its prefixed entry id are watched, and the page
     * binds whichever one the Host actually serves.
     */
    const ENTRIES = ['no-token', 'include:no-token']
    /** Dispatch key the Plugins page uses: `<package name>#<row id>`. */
    const ROW_KEY = 'dsh-no-token#no-token'
    /** Exact Fetch route the host serves for LAN control. */
    const LAN_PATH = '/api/no-token/lan'
    /** Selectable modes, matching the Host schema. */
    const MODES = ['loopback', 'all', 'off']

    const dictionaries = {
      zh: {
        title: '免 Token 访问',
        summary: '取消 Web 界面的强制 ?token= 验证，同时保留 Host/Origin 信任围栏。',
        hint: '选择哪些来源可以不携带 token 直接打开本界面。',
        loopback: '仅本机（默认）',
        loopbackHint: '只有 localhost / 127.0.0.1 / [::1] 免 token；从局域网地址访问仍需 token。',
        all: '所有可信来源',
        allHint: '凡通过 Host/Origin 围栏的请求一律免 token。仅当该端口只有你能访问时使用。',
        off: '关闭（恢复强制验证）',
        offHint: '保持官方行为：只有 dsh web 打印的带 token 链接能打开本界面。',
        effective: '生效中',
        overridden: '已覆盖插件默认值',
        reset: '恢复默认',
        save: '保存',
        saving: '保存中…',
        saved: '已保存，并即时作用于正在运行的进程。',
        failed: '本部署没有接受这个值，已保留供你重试。',
        readOnly: '本部署的设置为只读。',
        loading: '正在读取配置…',
        unavailable: '该插件当前未加载，暂时无法配置。',
        lanNav: '局域网访问',
        lanTitle: '局域网访问',
        lanIntro: '让同一 Wi-Fi 下的手机或另一台电脑也能打开这个界面。',
        lanStateOn: '已开启',
        lanStateOff: '已关闭',
        lanBind: '当前绑定',
        lanEnable: '开启局域网访问',
        lanDisable: '关闭局域网访问',
        lanWorking: '正在切换…',
        lanSwitching: '正在切换绑定，页面可能短暂断开；若长时间无响应请刷新页面。',
        lanOnNote: '已开启。重启 dsh web 后仍然生效，随时可以在这里关闭。',
        lanOffNote: '已关闭：只有这台电脑能打开。',
        lanOffUnreachable: '注意：现在服务只监听本机地址（127.0.0.1），手机连端口都连不上 —— 这不是 token 或密码的问题，打开上面的开关才会真正开放局域网。',
        lanAllNoTokenHint: '当前模式是「所有可信来源」：开关打开后，手机直接输入地址即可进入，不需要 token 也不需要密码。',
        lanNoAddress: '未检测到局域网地址（可能没有连接网络）。',
        lanScan: '用手机相机或微信扫描二维码即可打开，不需要输入任何东西。',
        lanFirstVisit: '手机第一次请扫码或复制链接；登录一次后，这台设备 30 天内直接输入地址也能打开。',
        lanMaybeVirtual: '可能是虚拟网卡/VPN，手机通常打不开这个地址',
        lanCopy: '复制链接',
        lanCopied: '已复制',
        lanCopyFailed: '复制失败，请手动选中上面的链接。',
        lanNeedsReload: '需重启后生效',
        lanFenceStale: '检测到地址有变化，重启 dsh web 后新地址才在信任名单里。',
        lanFirewall: '手机打不开？多半是 Windows 防火墙拦住了入站。以管理员身份运行 PowerShell 后执行：',
        lanCopyCommand: '复制命令',
        lanRiskLabel: '我了解：同一网络的任何人都能操作这台电脑',
        lanRiskWarn: '当前模式是「所有可信来源」。一旦开启局域网，同一网络上的任何人都能直接操作这台电脑（可以执行命令）。强烈建议先把模式改回「仅本机」。',
        lanFailed: '操作失败',
        lanRefresh: '刷新状态',
        lanHint: '开启后同时监听所有网卡；关闭后立即恢复仅本机。',
        lanModeNote: '手机扫码后走官方 token 登录，不需要放宽验证模式。',
        lanUnavailable: '本部署不支持修改绑定。',
        lanRestartHost: '主机端还没加载这个功能：重启一次 dsh web 后刷新本页即可。',
        lanPasswordTitle: '访问密码',
        lanPasswordHint: '设好之后，手机打开地址会看到密码输入框，输一次即可（30 天内免输）。不设密码就只能扫二维码或使用带 token 的链接。',
        lanPasswordPlaceholder: '设置一个密码（建议 8 位以上）',
        lanPasswordSave: '保存密码',
        lanPasswordClear: '清除密码',
        lanPasswordSaved: '密码已保存，手机刷新后即可用密码登录。',
        lanPasswordStateSet: '已设置',
        lanPasswordStateUnset: '未设置',
        lanPasswordEnv: '由环境变量 DSH_LAN_PASSWORD 提供，这里不能修改',
        lanPasswordShort: '密码太短，至少 4 位。',
      },
      en: {
        title: 'No-token access',
        summary: 'Removes the mandatory ?token= gate while keeping the Host/Origin fence.',
        hint: 'Choose which clients may open this UI without a token.',
        loopback: 'This machine only (default)',
        loopbackHint: 'Only localhost / 127.0.0.1 / [::1] skip the token; a LAN address still needs one.',
        all: 'Every trusted host',
        allHint: 'Any request that passes the Host/Origin fence skips the token. Use only when nothing else can reach this port.',
        off: 'Off (token required again)',
        offHint: 'Official behaviour: only the ?token= URL dsh web prints opens this UI.',
        effective: 'in force',
        overridden: 'Overrides the plugin default',
        reset: 'Reset to default',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved and applied to the running process.',
        failed: 'This deployment did not accept the value.',
        readOnly: 'This deployment stores settings read-only.',
        loading: 'Loading configuration…',
        unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
        lanNav: 'LAN access',
        lanTitle: 'LAN access',
        lanIntro: 'Let a phone or another computer on the same Wi-Fi open this UI.',
        lanStateOn: 'on',
        lanStateOff: 'off',
        lanBind: 'Bound to',
        lanEnable: 'Turn on LAN access',
        lanDisable: 'Turn off LAN access',
        lanWorking: 'Switching…',
        lanSwitching: 'Switching the bind; the page may disconnect briefly — refresh if it stays quiet.',
        lanOnNote: 'On. It survives a restart of dsh web, and you can turn it off here at any time.',
        lanOffNote: 'Off: only this computer can reach the UI.',
        lanOffUnreachable: 'Careful: the server is listening on this machine only (127.0.0.1), so no phone can even reach the port. That is not a token or password problem — only this switch opens the LAN.',
        lanAllNoTokenHint: 'The mode is “every trusted host”: once the switch is on, a phone opens the bare address with no token and no password.',
        lanNoAddress: 'No LAN address was found (the machine may be offline).',
        lanScan: 'Scan the code with the phone camera — nothing to type.',
        lanFirstVisit: 'On the phone, scan or copy the link the first time; afterwards that device can open the bare address for 30 days.',
        lanMaybeVirtual: 'likely a virtual adapter or VPN — a phone usually cannot reach this one',
        lanCopy: 'Copy link',
        lanCopied: 'Copied',
        lanCopyFailed: 'Copy failed; select the link above instead.',
        lanNeedsReload: 'needs a restart',
        lanFenceStale: 'An address changed; restart dsh web so the new one joins the trust list.',
        lanFirewall: 'Phone cannot connect? Windows Firewall most likely blocks the inbound port. Run this in an elevated PowerShell:',
        lanCopyCommand: 'Copy command',
        lanRiskLabel: 'I understand that anyone on this network could operate this computer',
        lanRiskWarn: 'The mode is “every trusted host”. With LAN access on, anyone on the same network can operate this computer directly (including running commands). Switch the mode back to “this machine only” first.',
        lanFailed: 'The request failed',
        lanRefresh: 'Refresh',
        lanHint: 'On: every interface is served. Off: loopback only.',
        lanModeNote: 'A phone still signs in through the official token link; the mode does not need to be relaxed.',
        lanUnavailable: 'This deployment cannot change the bind.',
        lanRestartHost: 'The host half has not loaded this feature: restart dsh web and reload this page.',
        lanPasswordTitle: 'Access password',
        lanPasswordHint: 'Once set, a phone sees a password field and types it once (then it is remembered for 30 days). Without one, only the QR code or the token link works.',
        lanPasswordPlaceholder: 'Set a password (8 characters or more)',
        lanPasswordSave: 'Save password',
        lanPasswordClear: 'Clear password',
        lanPasswordSaved: 'Password saved; refresh on the phone to sign in with it.',
        lanPasswordStateSet: 'set',
        lanPasswordStateUnset: 'not set',
        lanPasswordEnv: 'provided by the DSH_LAN_PASSWORD environment variable; it cannot be changed here',
        lanPasswordShort: 'Too short: use at least 4 characters.',
      },
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '560px' },
      hint: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
      options: { display: 'flex', flexDirection: 'column', gap: '8px' },
      option: (selected, disabled) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: `1px solid ${selected ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: selected ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : 1,
      }),
      radio: { marginTop: '3px', accentColor: 'var(--dsw-alias-brand-primary)' },
      optionText: { display: 'flex', flexDirection: 'column', gap: '2px' },
      optionTitle: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
      badge: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary)' },
      badgeWarn: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      // Above every layer, and click-through so it can never swallow a tap.
      debugBar: {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'env(safe-area-inset-bottom,0px)',
        zIndex: 2147483647,
        margin: 0,
        padding: '6px 8px',
        background: '#000',
        color: '#0f0',
        font: '11px/1.5 ui-monospace,SFMono-Regular,monospace',
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
      },
      textInput: {
        flex: '1 1 160px',
        minWidth: 0,
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '14px',
      },
      optionHint: { fontSize: '12px', lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' },
      footer: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      save: (disabled) => ({
        padding: '6px 14px',
        borderRadius: '6px',
        border: 'none',
        fontSize: '13px',
        background: disabled ? 'var(--dsw-alias-button-tool-bar-fill)' : 'var(--dsw-alias-button-primary-fill)',
        color: disabled ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-label-primary-foreground)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }),
      reset: (disabled) => ({
        padding: '6px 10px',
        borderRadius: '6px',
        fontSize: '13px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: disabled ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-label-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }),
      status: (tone) => ({
        fontSize: '12px',
        color: tone === 'error' ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-tertiary)',
      }),
      section: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '620px' },
      sectionTitle: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      statusRow: { display: 'flex', alignItems: 'baseline', gap: '4px', flexWrap: 'wrap' },
      statusLabel: { fontSize: '13px', color: 'var(--dsw-alias-label-tertiary)' },
      statusValue: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
      error: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-error)' },
      warning: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      warningText: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-error)' },
      checkboxRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      cardHead: { display: 'flex', alignItems: 'baseline', gap: '6px' },
      qrBox: { display: 'flex', justifyContent: 'center', padding: '4px' },
      qrSvg: { display: 'block', background: '#ffffff', borderRadius: '6px' },
      mono: {
        display: 'block',
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        lineHeight: '18px',
        wordBreak: 'break-all',
        whiteSpace: 'pre-wrap',
      },
    }

    /**
     * Values `apply` publishes for the registered component. The slot
     * registration also injects them as props; this module-level handle keeps
     * the page working on a client build whose registration options differ.
     */
    const shared = {
      controller: undefined,
      lan: undefined,
      t: (key) => key,
    }

    /**
     * Follow one shared config form's snapshot.
     * @param controller - the entry's `ConfigFormController`.
     * @returns the current snapshot, re-read after every change.
     */
    function useSnapshot(controller) {
      const [snapshot, setSnapshot] = React.useState(() => controller.getSnapshot())
      React.useEffect(() => {
        setSnapshot(controller.getSnapshot())
        return controller.subscribe(() => {
          setSnapshot(controller.getSnapshot())
        })
      }, [controller])
      return snapshot
    }

    /**
     * The row's configuration: one mode choice, its save, and its reset.
     * @param props - the owner's `view`, plus the injected controller and `t`.
     * @returns a one-liner for `view: 'summary'`, else the form.
     */
    function NoTokenCard(props) {
      const controller = props.controller ?? shared.controller
      const t = props.t ?? shared.t
      const snapshot = useSnapshot(controller)
      const [draft, setDraft] = React.useState(undefined)
      const [phase, setPhase] = React.useState('idle')

      if (props.view === 'summary') return t('summary')
      if (controller === undefined) return null
      if (snapshot.status === 'loading') return h('p', { style: styles.hint }, t('loading'))
      if (snapshot.status !== 'ready') return h('p', { style: styles.hint }, t('unavailable'))

      const stored = snapshot.value ?? {}
      const inherited = snapshot.base ?? {}
      const mode = MODES.includes(stored.mode) ? stored.mode : 'loopback'
      const shown = draft ?? mode
      const dirty = shown !== mode
      const overridden = inherited.mode !== undefined && inherited.mode !== mode
      const readOnly = snapshot.writable !== true
      const busy = phase === 'saving'
      const disabled = readOnly || busy

      const choose = (next) => {
        setDraft(next)
        setPhase('idle')
      }

      const write = async (commit) => {
        setPhase('saving')
        let landed = false
        try {
          landed = await commit()
        } catch {
          landed = false
        }
        setPhase(landed ? 'saved' : 'failed')
        if (landed) setDraft(undefined)
      }

      return h(
        'div',
        { style: styles.root },
        h('p', { style: styles.hint }, readOnly ? t('readOnly') : t('hint')),
        h(
          'div',
          { role: 'radiogroup', 'aria-label': t('hint'), style: styles.options },
          MODES.map((option) => h(
            'label',
            { key: option, style: styles.option(shown === option, disabled) },
            h('input', {
              type: 'radio',
              name: 'dsh-no-token-mode',
              value: option,
              checked: shown === option,
              disabled,
              onChange: () => choose(option),
              style: styles.radio,
            }),
            h(
              'span',
              { style: styles.optionText },
              h(
                'span',
                { style: styles.optionTitle },
                t(option),
                option === mode ? h('span', { style: styles.badge }, ` · ${t('effective')}`) : null,
              ),
              h('span', { style: styles.optionHint }, t(`${option}Hint`)),
            ),
          )),
        ),
        h(
          'div',
          { style: styles.footer },
          h(
            'button',
            {
              type: 'button',
              disabled: disabled || !dirty,
              style: styles.save(disabled || !dirty),
              onClick: () => write(() => controller.set('mode', shown)),
            },
            busy ? t('saving') : t('save'),
          ),
          overridden
            ? h(
              'button',
              {
                type: 'button',
                disabled,
                style: styles.reset(disabled),
                onClick: () => write(() => controller.unset('mode')),
              },
              t('reset'),
            )
            : null,
          h(
            'span',
            { style: styles.status(phase === 'failed' ? 'error' : 'muted') },
            phase === 'saved' ? t('saved') : phase === 'failed' ? t('failed') : overridden ? t('overridden') : '',
          ),
        ),
      )
    }

    //#region QR code (fixed version 6, EC level M, byte mode)
    /**
     * A QR encoder for exactly one kind of payload: a LAN URL. Version 6 at EC
     * level M carries 108 data codewords — 106 payload bytes — which covers
     * `http://255.255.255.255:65535/?token=` plus a 43-character token, so one
     * version's block table is enough and, being below version 7, no
     * version-information field is due. Written here rather than required from
     * the module table: the table offers only baseline libraries, and a plugin
     * must not depend on a Harness Client package.
     */
    const qr = (() => {
      const VERSION = 6
      const SIZE = 17 + 4 * VERSION
      const BLOCKS = 4
      const DATA_PER_BLOCK = 27
      const EC_PER_BLOCK = 16
      const DATA_CODEWORDS = BLOCKS * DATA_PER_BLOCK
      const DARK_MODULE_ROW = SIZE - 8

      const EXP = new Uint8Array(512)
      const LOG = new Uint8Array(256)
      for (let index = 0, value = 1; index < 255; index += 1) {
        EXP[index] = value
        LOG[value] = index
        value <<= 1
        if ((value & 0x100) !== 0) value ^= 0x11d
      }
      for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255]
      const multiply = (left, right) => (left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]])

      /**
       * Generator polynomial of one degree, highest power first.
       * @param degree - number of EC codewords.
       * @returns coefficient list.
       */
      function generator(degree) {
        let poly = [1]
        for (let index = 0; index < degree; index += 1) {
          const factor = EXP[index]
          const next = new Array(poly.length + 1).fill(0)
          for (let term = 0; term < poly.length; term += 1) {
            next[term] ^= poly[term]
            next[term + 1] ^= multiply(poly[term], factor)
          }
          poly = next
        }
        return poly
      }

      /**
       * Reed-Solomon remainder of one data block.
       * @param block - the block's data codewords.
       * @returns its EC codewords.
       */
      function remainder(block) {
        const poly = generator(EC_PER_BLOCK)
        const work = Uint8Array.from([...block, ...new Array(EC_PER_BLOCK).fill(0)])
        for (let index = 0; index < block.length; index += 1) {
          const factor = work[index]
          if (factor === 0) continue
          for (let term = 0; term < poly.length; term += 1) work[index + term] ^= multiply(poly[term], factor)
        }
        return work.slice(block.length)
      }

      /**
       * The 15 format bits for EC level M and one mask.
       * @param mask - mask pattern index.
       * @returns the masked BCH codeword.
       */
      function formatBits(mask) {
        const data = mask
        let rest = data << 10
        for (let index = 14; index >= 10; index -= 1) {
          if (((rest >> index) & 1) !== 0) rest ^= 0x537 << (index - 10)
        }
        return (((data << 10) | rest) ^ 0x5412) & 0x7fff
      }

      /**
       * Reserve every function module and draw its fixed pattern.
       * @returns the reservation map and the starting matrix.
       */
      function skeleton() {
        const reserved = Array.from({ length: SIZE }, () => new Uint8Array(SIZE))
        const modules = Array.from({ length: SIZE }, () => new Uint8Array(SIZE))
        const write = (row, col, dark) => {
          reserved[row][col] = 1
          modules[row][col] = dark ? 1 : 0
        }
        const finder = (top, left) => {
          for (let row = -1; row <= 7; row += 1) {
            for (let col = -1; col <= 7; col += 1) {
              const y = top + row
              const x = left + col
              if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) continue
              const inside = row >= 0 && row <= 6 && col >= 0 && col <= 6
              const dark = inside
                && (row === 0 || row === 6 || col === 0 || col === 6 || (row >= 2 && row <= 4 && col >= 2 && col <= 4))
              write(y, x, dark)
            }
          }
        }
        finder(0, 0)
        finder(0, SIZE - 7)
        finder(SIZE - 7, 0)
        for (let index = 8; index < SIZE - 8; index += 1) {
          write(6, index, index % 2 === 0)
          write(index, 6, index % 2 === 0)
        }
        const center = SIZE - 7
        for (let row = -2; row <= 2; row += 1) {
          for (let col = -2; col <= 2; col += 1) {
            write(center + row, center + col, Math.max(Math.abs(row), Math.abs(col)) !== 1)
          }
        }
        for (let index = 0; index <= 8; index += 1) {
          for (const [row, col] of [[index, 8], [8, index]]) {
            if (reserved[row][col] === 0) write(row, col, false)
          }
        }
        for (let index = 0; index < 8; index += 1) {
          for (const [row, col] of [[SIZE - 1 - index, 8], [8, SIZE - 1 - index]]) {
            if (reserved[row][col] === 0) write(row, col, false)
          }
        }
        write(DARK_MODULE_ROW, 8, true)
        return { reserved, modules }
      }

      /**
       * Lay the interleaved codewords into the reserved-free modules.
       * @param modules - the matrix being filled.
       * @param reserved - the function-module map.
       * @param codewords - interleaved data and EC codewords.
       * @returns how many bits were placed.
       */
      function place(modules, reserved, codewords) {
        let placed = 0
        let upward = true
        for (let right = SIZE - 1; right >= 1; right -= 2) {
          if (right === 6) right = 5
          for (let step = 0; step < SIZE; step += 1) {
            const row = upward ? SIZE - 1 - step : step
            for (let offset = 0; offset < 2; offset += 1) {
              const col = right - offset
              if (reserved[row][col] === 1) continue
              const byte = codewords[placed >> 3]
              modules[row][col] = byte === undefined ? 0 : (byte >> (7 - (placed & 7))) & 1
              placed += 1
            }
          }
          upward = !upward
        }
        return placed
      }

      const MASKS = [
        (row, col) => (row + col) % 2 === 0,
        (row) => row % 2 === 0,
        (row, col) => col % 3 === 0,
        (row, col) => (row + col) % 3 === 0,
        (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
        (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
        (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
        (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
      ]

      /**
       * The spec's four penalty rules; the lowest-scoring mask is chosen.
       * @param modules - one masked matrix.
       * @returns its penalty score.
       */
      function penalty(modules) {
        let score = 0
        const at = (row, col) => modules[row][col]
        for (let first = 0; first < SIZE; first += 1) {
          let runRow = 0
          let runCol = 0
          for (let second = 0; second < SIZE; second += 1) {
            runRow = second > 0 && at(first, second) === at(first, second - 1) ? runRow + 1 : 1
            if (runRow === 5) score += 3
            else if (runRow > 5) score += 1
            runCol = second > 0 && at(second, first) === at(second - 1, first) ? runCol + 1 : 1
            if (runCol === 5) score += 3
            else if (runCol > 5) score += 1
          }
        }
        for (let row = 0; row < SIZE - 1; row += 1) {
          for (let col = 0; col < SIZE - 1; col += 1) {
            const value = at(row, col)
            if (value === at(row, col + 1) && value === at(row + 1, col) && value === at(row + 1, col + 1)) score += 3
          }
        }
        const edge = [1, 0, 1, 1, 1, 0, 1]
        const check = (get) => {
          for (let start = 0; start + 11 <= SIZE; start += 1) {
            const pattern = (offset) => edge.every((bit, index) => get(start + index + offset) === bit)
            const quiet = (offset) => [0, 1, 2, 3].every((index) => get(start + index + offset) === 0)
            if (pattern(4) && quiet(0)) score += 40
            if (pattern(0) && quiet(7)) score += 40
          }
        }
        for (let row = 0; row < SIZE; row += 1) check((index) => at(row, index))
        for (let col = 0; col < SIZE; col += 1) check((index) => at(index, col))
        let dark = 0
        for (const row of modules) for (const value of row) dark += value
        const ratio = (dark * 100) / (SIZE * SIZE)
        score += Math.floor(Math.abs(ratio - 50) / 5) * 10
        return score
      }

      /**
       * One masked matrix with its format information in place.
       * @param codewords - interleaved codewords.
       * @param mask - mask pattern index.
       * @returns the finished matrix.
       */
      function build(codewords, mask) {
        const { reserved, modules } = skeleton()
        place(modules, reserved, codewords)
        for (let row = 0; row < SIZE; row += 1) {
          for (let col = 0; col < SIZE; col += 1) {
            if (reserved[row][col] === 1) continue
            if (MASKS[mask](row, col)) modules[row][col] ^= 1
          }
        }
        const format = formatBits(mask)
        const bit = (index) => (format >> index) & 1
        for (let index = 0; index <= 5; index += 1) modules[index][8] = bit(index)
        modules[7][8] = bit(6)
        modules[8][8] = bit(7)
        modules[8][7] = bit(8)
        for (let index = 9; index < 15; index += 1) modules[8][14 - index] = bit(index)
        for (let index = 0; index < 8; index += 1) modules[8][SIZE - 1 - index] = bit(index)
        for (let index = 8; index < 15; index += 1) modules[SIZE - 15 + index][8] = bit(index)
        modules[DARK_MODULE_ROW][8] = 1
        return modules
      }

      /**
       * Frame one payload as data codewords.
       * @param text - the payload.
       * @returns data codewords, or undefined when it does not fit.
       */
      function payload(text) {
        const bytes = new TextEncoder().encode(text)
        if (bytes.length > DATA_CODEWORDS - 2) return undefined
        const bits = []
        const push = (value, length) => {
          for (let index = length - 1; index >= 0; index -= 1) bits.push((value >> index) & 1)
        }
        push(0b0100, 4)
        push(bytes.length, 8)
        for (const byte of bytes) push(byte, 8)
        for (let index = 0; index < Math.min(4, DATA_CODEWORDS * 8 - bits.length); index += 1) bits.push(0)
        while (bits.length % 8 !== 0) bits.push(0)
        const codewords = []
        for (let index = 0; index < bits.length; index += 8) {
          let value = 0
          for (let offset = 0; offset < 8; offset += 1) value = (value << 1) | bits[index + offset]
          codewords.push(value)
        }
        for (let pad = 0; codewords.length < DATA_CODEWORDS; pad += 1) codewords.push(pad % 2 === 0 ? 0xec : 0x11)
        return codewords
      }

      /**
       * Encode one payload, choosing the mask with the lowest penalty.
       * @param text - the payload.
       * @returns `{ size, modules }`, or undefined when it does not fit.
       */
      function encode(text) {
        const data = payload(text)
        if (data === undefined) return undefined
        const blocks = []
        for (let index = 0; index < BLOCKS; index += 1) {
          const block = data.slice(index * DATA_PER_BLOCK, (index + 1) * DATA_PER_BLOCK)
          blocks.push({ data: block, ec: remainder(block) })
        }
        const stream = []
        for (let index = 0; index < DATA_PER_BLOCK; index += 1) for (const block of blocks) stream.push(block.data[index])
        for (let index = 0; index < EC_PER_BLOCK; index += 1) for (const block of blocks) stream.push(block.ec[index])
        let best
        let bestScore = Infinity
        for (let mask = 0; mask < MASKS.length; mask += 1) {
          const modules = build(stream, mask)
          const score = penalty(modules)
          if (score < bestScore) {
            bestScore = score
            best = modules
          }
        }
        return { size: SIZE, modules: best }
      }

      return { encode, size: SIZE }
    })()

    /**
     * Render one encoded matrix as a single path, run-length encoded per row.
     * @param matrix - `{ size, modules }` from `qr.encode`.
     * @param quiet - quiet-zone width in modules.
     * @returns the path's `d` attribute.
     */
    function qrPath(matrix, quiet = 4) {
      const parts = []
      for (let row = 0; row < matrix.size; row += 1) {
        let col = 0
        while (col < matrix.size) {
          if (matrix.modules[row][col] !== 1) {
            col += 1
            continue
          }
          let end = col
          while (end + 1 < matrix.size && matrix.modules[row][end + 1] === 1) end += 1
          const length = end - col + 1
          parts.push(`M${col + quiet} ${row + quiet}h${length}v1h-${length}z`)
          col = end + 1
        }
      }
      return parts.join('')
    }

    //#endregion

    //#region LAN page
    /**
     * Whether an address sits in a private LAN range — what a phone on the same
     * Wi-Fi can actually reach. VPN and virtual adapters hand out anything else,
     * so those sort last and carry a caution instead of misleading the scan.
     * @param address - dotted-quad address.
     * @returns true for 10/8, 172.16/12 and 192.168/16.
     */
    function isPrivateLan(address) {
      const [first, second] = address.split('.').map(Number)
      if (first === 10) return true
      if (first === 192 && second === 168) return true
      return first === 172 && second >= 16 && second <= 31
    }

    /**
     * The LAN page's snapshot store: one read, one write, and a poll that rides
     * out the connection drop a rebind causes.
     * @param request - performs one control request (`{ method, body }`).
     * @returns the store the page binds to.
     */
    function createLanStore(request) {
      let snapshot = { status: 'loading', state: undefined, error: undefined, busy: false, notice: undefined }
      const listeners = new Set()
      const publish = (patch) => {
        snapshot = { ...snapshot, ...patch }
        for (const listener of [...listeners]) listener()
      }
      const wait = (milliseconds) => new Promise((resolve) => {
        setTimeout(resolve, milliseconds)
      })
      const read = async () => {
        const response = await request({ method: 'GET' })
        if (response.status === 404) {
          // The host half of this bundle has not loaded the route yet, which
          // means the running process predates it.
          const error = new Error('host-route-missing')
          error.code = 'host-route-missing'
          throw error
        }
        const body = await response.json()
        if (body?.ok !== true) throw new Error(body?.error ?? `HTTP ${response.status}`)
        return body.state
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        async refresh() {
          try {
            publish({ status: 'ready', state: await read(), error: undefined })
          } catch (error) {
            publish({ status: 'error', state: undefined, error: error instanceof Error ? error.message : String(error) })
          }
        },
        async setPassword(value) {
          if (snapshot.busy) return
          publish({ busy: true, error: undefined })
          try {
            const response = await request({ method: 'POST', body: JSON.stringify({ password: value }) })
            const body = await response.json().catch(() => ({}))
            if (body?.ok !== true) throw new Error(body?.error ?? `HTTP ${response.status}`)
            publish({ busy: false, status: 'ready', state: body.state, error: undefined, notice: 'password' })
          } catch (error) {
            publish({ busy: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
        async setEnabled(enabled) {
          if (snapshot.busy) return
          publish({ busy: true, notice: 'switching', error: undefined })
          let failure
          try {
            const response = await request({ method: 'POST', body: JSON.stringify({ enabled }) })
            const body = await response.json().catch(() => ({}))
            if (body?.ok !== true) failure = body?.error ?? `HTTP ${response.status}`
          } catch {
            /* the rebind closes connections; the poll below decides the outcome */
          }
          for (let attempt = 0; attempt < 20; attempt += 1) {
            await wait(500)
            try {
              const state = await read()
              if (state.enabled === enabled) {
                publish({ busy: false, status: 'ready', state, error: undefined, notice: enabled ? 'on' : 'off' })
                return
              }
            } catch {
              /* keep polling while the server rebinds */
            }
          }
          publish({ busy: false, notice: 'timeout', error: failure ?? 'the bind did not change' })
          try {
            publish({ state: await read() })
          } catch {
            /* keep the last state */
          }
        },
      }
    }

    /**
     * The independent Settings section: one switch for LAN access, the links to
     * open from another device, and their codes.
     * @param props - the injected store and locale reader.
     * @returns the section.
     */
    function LanSection(props) {
      const store = props.store ?? shared.lan
      const t = props.t ?? shared.t
      const snapshot = useSnapshot(store)
      const [accepted, setAccepted] = React.useState(false)
      const [copied, setCopied] = React.useState(undefined)
      const [draft, setDraft] = React.useState('')

      if (store === undefined) return null

      const state = snapshot.state
      const enabled = state?.enabled === true
      const risky = state?.mode === 'all'
      const blocked = risky && !enabled && !accepted
      const busy = snapshot.busy === true

      const copy = async (value, key) => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(key)
        } catch {
          setCopied('failed')
        }
      }

      // A private LAN address is the one a phone on the same Wi-Fi can reach;
      // VPN and virtual adapters sort last so the first code is the useful one.
      const addresses = [...(state?.addresses ?? [])]
        .sort((left, right) => Number(isPrivateLan(right.address)) - Number(isPrivateLan(left.address)))
      const notice = snapshot.notice === 'switching'
        ? t('lanSwitching')
        : snapshot.notice === 'on'
          ? t('lanOnNote')
          : snapshot.notice === 'off'
            ? t('lanOffNote')
            : snapshot.notice === 'password'
              ? t('lanPasswordSaved')
              : undefined

      return h(
        'div',
        { style: styles.section },
        h('h2', { style: styles.sectionTitle }, t('lanTitle')),
        h('p', { style: styles.hint }, t('lanIntro')),
        enabled ? h('p', { style: styles.hint }, t('lanFirstVisit')) : null,
        h(
          'div',
          { style: styles.statusRow },
          h('span', { style: styles.statusLabel }, `${t('lanBind')}: `),
          h('span', { style: styles.statusValue }, `${state?.bind ?? '—'}${state?.port === undefined ? '' : `:${state.port}`}`),
          h('span', { style: styles.statusLabel }, ` · ${enabled ? t('lanStateOn') : t('lanStateOff')}`),
        ),
        snapshot.status === 'error'
          ? h('p', { style: styles.error }, `${t('lanFailed')}: ${(snapshot.error === 'host-route-missing' ? t('lanRestartHost') : snapshot.error) ?? snapshot.error ?? 'unavailable'}`)
          : null,
        // The password is the mobile-friendly credential: a phone types it once
        // and keeps the shipped 30-day cookie. Only its presence is ever read
        // back, never its value.
        h(
          'div',
          { style: styles.card },
          h(
            'div',
            { style: styles.cardHead },
            h('strong', { style: styles.statusValue }, t('lanPasswordTitle')),
            h('span', { style: styles.badgeWarn }, ` · ${state?.password?.set === true ? t('lanPasswordStateSet') : t('lanPasswordStateUnset')}`),
          ),
          h('p', { style: styles.hint }, t('lanPasswordHint')),
          state?.password?.writable === false
            ? h('p', { style: styles.hint }, t('lanPasswordEnv'))
            : h(
              'div',
              { style: styles.footer },
              h('input', {
                type: 'password',
                value: draft,
                placeholder: t('lanPasswordPlaceholder'),
                autoComplete: 'new-password',
                disabled: busy,
                style: styles.textInput,
                onChange: (event) => {
                  setDraft(event.target.value)
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || draft.length < 4,
                  style: styles.save(busy || draft.length < 4),
                  onClick: () => {
                    store.setPassword(draft)
                    setDraft('')
                  },
                },
                t('lanPasswordSave'),
              ),
              state?.password?.set === true
                ? h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy,
                    style: styles.reset(busy),
                    onClick: () => {
                      store.setPassword(null)
                    },
                  },
                  t('lanPasswordClear'),
                )
                : null,
            ),
          draft.length > 0 && draft.length < 4 ? h('p', { style: styles.error }, t('lanPasswordShort')) : null,
        ),
        // Editing the mode does not open the port: the two switches are separate,
        // and confusing them is the mistake this line exists to prevent.
        !enabled
          ? h('p', { style: styles.warningText }, state?.mode === 'all' ? `${t('lanOffUnreachable')} ${t('lanAllNoTokenHint')}` : t('lanOffUnreachable'))
          : null,
        risky
          ? h(
            'div',
            { style: styles.warning },
            h('p', { style: styles.warningText }, t('lanRiskWarn')),            h(
              'label',
              { style: styles.checkboxRow },
              h('input', {
                type: 'checkbox',
                checked: accepted,
                disabled: busy || enabled,
                onChange: (event) => setAccepted(event.target.checked === true),
                style: styles.radio,
              }),
              h('span', null, t('lanRiskLabel')),
            ),
          )
          : null,
        h(
          'div',
          { style: styles.footer },
          h(
            'button',
            {
              type: 'button',
              disabled: busy || blocked,
              style: styles.save(busy || blocked),
              onClick: () => {
                store.setEnabled(!enabled)
              },
            },
            busy ? t('lanWorking') : enabled ? t('lanDisable') : t('lanEnable'),
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              style: styles.reset(busy),
              onClick: () => {
                store.refresh()
              },
            },
            t('lanRefresh'),
          ),
          h('span', { style: styles.status('muted') }, notice ?? ''),
        ),
        addresses.length === 0
          ? h('p', { style: styles.hint }, t('lanNoAddress'))
          : null,
        state?.notes?.includes('fence-stale') === true ? h('p', { style: styles.warningText }, t('lanFenceStale')) : null,
        enabled
          ? addresses.map((entry) => {
            const matrix = entry.usable ? qr.encode(entry.loginUrl) : undefined
            return h(
              'div',
              { key: entry.address, style: styles.card },
              h('div', { style: styles.cardHead },
                h('strong', { style: styles.statusValue }, entry.address),
                isPrivateLan(entry.address) ? null : h('span', { style: styles.badgeWarn }, ` · ${t('lanMaybeVirtual')}`),
                entry.usable
                  ? null
                  : h('span', { style: styles.badge }, ` · ${t('lanNeedsReload')}`)),
              matrix === undefined
                ? h('p', { style: styles.hint }, t('lanCopyFailed'))
                : h('div', { style: styles.qrBox },
                  h('svg', {
                    viewBox: `0 0 ${matrix.size + 8} ${matrix.size + 8}`,
                    width: 168,
                    height: 168,
                    role: 'img',
                    'aria-label': entry.loginUrl,
                    style: styles.qrSvg,
                  }, h('path', { d: qrPath(matrix), fill: '#000000', shapeRendering: 'crispEdges' }))),
              matrix === undefined ? null : h('p', { style: styles.hint }, t('lanScan')),
              h('code', { style: styles.mono }, entry.loginUrl),
              h(
                'div',
                { style: styles.footer },
                h(
                  'button',
                  {
                    type: 'button',
                    style: styles.reset(false),
                    onClick: () => copy(entry.loginUrl, entry.address),
                  },
                  copied === entry.address ? t('lanCopied') : t('lanCopy'),
                ),
                copied === 'failed' ? h('span', { style: styles.error }, t('lanCopyFailed')) : null,
              ),
            )
          })
          : null,
        enabled
          ? h(
            'div',
            { style: styles.card },
            h('p', { style: styles.hint }, t('lanFirewall')),
            h('code', { style: styles.mono }, 'New-NetFirewallRule -DisplayName "DSH Web 3080" -Direction Inbound -Protocol TCP -LocalPort 3080 -Action Allow -Profile Private'),
            h(
              'div',
              { style: styles.footer },
              h(
                'button',
                {
                  type: 'button',
                  style: styles.reset(false),
                  onClick: () => copy('New-NetFirewallRule -DisplayName "DSH Web 3080" -Direction Inbound -Protocol TCP -LocalPort 3080 -Action Allow -Profile Private', 'firewall'),
                },
                copied === 'firewall' ? t('lanCopied') : t('lanCopyCommand'),
              ),
            ),
          )
          : null,
        h('p', { style: styles.hint }, t('lanHint')),
        h('p', { style: styles.hint }, t('lanModeNote')),
      )
    }

    //#endregion

    //#region mobile layout
    /**
     * The stylesheet the Host injects into the document head, carried here as well
     * so a phone sees the corrected layout on its next reload instead of waiting for
     * a Host restart. verify-mobile.mjs asserts the two copies are byte-identical,
     * and MobileStyle renders nothing once the Host's copy is in the document.
     */
    const MOBILE_CSS = `/* dsh-no-token/mobile */
@media (max-width: 820px) {
  html, body, #root { height: 100dvh; max-width: 100%; overflow-x: hidden; }
  html { -webkit-text-size-adjust: 100%; }
  body { overscroll-behavior-y: none; }
  *, *::before, *::after { -webkit-tap-highlight-color: transparent; }
  /* iOS zooms any focused control under 16px and does not zoom back out. */
  input, textarea, select { font-size: 16px !important; }
  button, [role="button"], [role="tab"], [role="menuitem"] { touch-action: manipulation; }
  img, video, canvas { max-width: 100%; height: auto; }
  [class*="_tableScroll_"] { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  pre, table { max-width: 100%; overflow-x: auto; }

  /* ---- the frame ----------------------------------------------------------
     From dsh-client-ui-layout/lib/client.js:

       computeColumns(viewport, sidebar, rightbar, collapsedWidth = 56) {
         const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, 264, 420);
         const available = viewport - s - 400;
         const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * RIGHTBAR_MAX_RATIO));
         return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
       }

     and the frame's columns are set as inline styles:

       gridTemplateColumns: cols.sidebar + "px minmax(" + (cols.rightbar === 0 ? 0 : 400) + "px, 1fr) minmax(0px, " + rightbarMax + "px)"

     So on a phone an *expanded* sidebar is a fixed 264-420px column, and any
     tracked right pane floors the centre at 400px - either way the conversation is
     left with a strip. Only the template is overridden here: the shell's own CSS
     places no grid-column on the three items, so they are pinned to their tracks
     (necessary, because an absolutely positioned sidebar would otherwise let
     auto-placement slide the centre into the first track). The right column stays
     a zero-width track, which is exactly what its occupant expects: per the layout
     source it draws its panel anchored to the frame's right edge and only uses the
     track to ask the centre for room — so the pane covers the conversation
     instead of squeezing it. overlayLayer, leadingSeat and handle are
     already position:absolute in the shell CSS and stay out of the flow. ----- */
  [class$="_frame"], [class*="_frame "] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
  [class$="_frame"][data-sidebar-collapsed], [class*="_frame "][data-sidebar-collapsed] {
    grid-template-columns: 56px minmax(0, 1fr) 0 !important;
  }
  /* macOS desktop hides the rail entirely (collapsedWidth = 0 there). */
  html[data-platform="darwin"] [class$="_frame"][data-sidebar-collapsed],
  html[data-platform="darwin"] [class*="_frame "][data-sidebar-collapsed] {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  }
  [class*="_sidebarCol"] { grid-column: 1 !important; grid-row: 1 !important; }
  [class*="_centerCol"] { grid-column: 2 !important; grid-row: 1 !important; min-width: 0 !important; }
  [class*="_rightbarCol"] { grid-column: 3 !important; grid-row: 1 !important; }
  /* Expanded on a phone the session list is the official app's drawer: it covers
     the conversation instead of taking a column out of it. SidebarRoot freezes
     its content at the last expanded width through an inline style, so the drawer
     also caps that child. */
  [class$="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"],
  [class*="_frame "]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] {
    position: absolute !important;
    /* Absolute children are placed against the frame's padding box, so the frame's
       own inset padding does not reach them: the drawer states its top and leading
       insets itself. It keeps bottom: 0 so the scrim below still covers the gesture
       bar, and pads its content off it instead. */
    inset: env(safe-area-inset-top) auto 0 env(safe-area-inset-left) !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
    z-index: 40 !important;
    width: min(86vw, 320px) !important;
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 45%) !important;
  }
  [class$="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > *,
  [class*="_frame "]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > * {
    max-width: 100% !important;
  }

  /* ---- safe areas ---------------------------------------------------------
     Only ever non-zero once the served viewport meta carries viewport-fit=cover,
     which the Host adds through its tapIndex transform (see withMobileViewport).
     The frame is content-box in the shell - only its Windows-titlebar variant
     states border-box explicitly - so the box model is stated here, or the
     padding would push the 100% height over the viewport. padding-top
     deliberately carries no !important: the shell's own rule
     [data-windows-titlebar] .frame { padding-top: var(--dsh-windows-titlebar-height) }
     is more specific and must keep winning on a Windows desktop, where every
     inset here resolves to 0. The bottom is left alone: the composer already owns
     it, and padding it twice would lift it off the gesture bar. -------------- */
  [class$="_frame"], [class*="_frame "] {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }

  /* ---- the conversation --------------------------------------------------- */
  /* Desktop gutters are about 40px a side; a phone wants the width for text. */
  [class*="_content_"], [class*="_viewArea_"], [class*="_scrollBody_"], [class*="_body_"] {
    min-width: 0 !important;
    padding-left: 12px !important;
    padding-right: 12px !important;
  }
  /* The greeting is set for a desktop hero; the phone size is about 22px. */
  [class*="_headline_"] { font-size: 22px !important; line-height: 1.35 !important; }
  [class*="_hero_"] { padding-left: 12px !important; padding-right: 12px !important; }
  /* The composer clears the gesture bar instead of sitting under it. */
  [class*="_composerSeat_"], [class*="_composerHero_"], [class*="_composerStack_"] {
    padding-left: 8px !important;
    padding-right: 8px !important;
    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;
  }
  [class*="_editor_"] { min-height: 40px; }

  /* ---- touch affordances -------------------------------------------------- */
  [class*="_iconButton_"], [class*="_actionButton_"] { min-width: 36px !important; min-height: 36px !important; }
  [class*="_row_"], [class*="_menuItem_"], [class*="_item_"] { min-height: 38px; }

  /* ---- overlays ---------------------------------------------------------- */
  [class*="_backdrop_"] {
    padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)) !important;
  }
  [role="dialog"] {
    max-width: 100% !important;
    max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
  }
  [role="menu"], [role="listbox"], [class*="_menu_"] { max-width: 92vw !important; }
}

/* ---- landscape phones and small tablets ------------------------------------
   The shell's own narrow mode begins at SIDEBAR_AUTO_COLLAPSE = 1024
   (dsh-client-ui-layout), so a phone held sideways - about 844-932 CSS px - is
   already inside it while the block above, keyed to 820px, no longer matches.
   Only device-level rules belong here: at these widths the shell's own narrow
   layout (a 56px rail plus its own narrowExpanded drawer) is the right one, and
   restating the three-column template would also reshape a 900px desktop window.
   pointer: coarse is the primary pointer, so a mouse-driven window never matches,
   and every safe-area inset is 0 without viewport-fit=cover anyway. ----------- */
@media (pointer: coarse) and (min-width: 821px) and (max-width: 1023.98px) {
  html { -webkit-text-size-adjust: 100%; }
  body { overscroll-behavior-y: none; }
  *, *::before, *::after { -webkit-tap-highlight-color: transparent; }
  /* iOS zooms any focused control under 16px, in either orientation. */
  input, textarea, select { font-size: 16px !important; }
  button, [role="button"], [role="tab"], [role="menuitem"] { touch-action: manipulation; }
  [class$="_frame"], [class*="_frame "] {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  [class*="_iconButton_"], [class*="_actionButton_"] { min-width: 36px !important; min-height: 36px !important; }
  [class*="_composerSeat_"], [class*="_composerHero_"], [class*="_composerStack_"] {
    padding-left: max(8px, env(safe-area-inset-left)) !important;
    padding-right: max(8px, env(safe-area-inset-right)) !important;
    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;
  }
  [role="dialog"] {
    max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
  }
}
`

    /** The sentinel both copies carry, so the two never apply at once. */
    const MOBILE_SENTINEL = 'dsh-no-token/mobile'

    /** The viewport keys the Host writes into the served document (see index.js). */
    const MOBILE_VIEWPORT_KEYS = 'viewport-fit=cover, interactive-widget=resizes-content'

    /**
     * Add the mobile viewport keys to this document, and hand back a restore.
     *
     * `viewport-fit=cover` is what makes any `env(safe-area-inset-*)` in the
     * stylesheet non-zero: without it the browser keeps the notch and the home
     * indicator outside the layout, every inset rule resolves to zero, and the
     * composer sits on the indicator. The Host rewrites the served document, and
     * this covers the same gap the stylesheet fallback covers — a document that
     * predates the Host change.
     * @returns a disposer restoring the original content attribute.
     */
    function applyMobileViewport() {
      if (typeof document === 'undefined') return () => {}
      const meta = document.querySelector('meta[name="viewport"]')
      if (meta === null) return () => {}
      const original = meta.getAttribute('content')
      const owned = /^(?:viewport-fit|interactive-widget)=/i
      const parts = (original ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '' && !owned.test(part))
      const next = [...parts, ...MOBILE_VIEWPORT_KEYS.split(', ')].join(', ')
      if (next !== original) meta.setAttribute('content', next)
      return () => {
        if (original === null) meta.removeAttribute('content')
        else meta.setAttribute('content', original)
      }
    }

    /**
     * Render the stylesheet only while the Host's copy is absent.
     * @returns the style element, or null when the document already carries one.
     */
    function MobileStyle() {
      const [needed] = React.useState(() => {
        if (typeof document === 'undefined') return false
        return ![...document.querySelectorAll('style')].some((tag) => (tag.textContent ?? '').includes(MOBILE_SENTINEL))
      })
      return needed ? h('style', { 'data-dsh-no-token-mobile': '' }, MOBILE_CSS) : null
    }

    /** The roster revision this document booted from. */
    function bootedRevision() {
      const boot = globalThis.__DSH_BOOT__
      return typeof boot?.rev === 'string' ? boot.rev : undefined
    }

    /**
     * Reload when the server advertises a different roster revision.
     *
     * Every client module URL carries a content revision, so a changed module is a
     * changed URL — but only a document load picks it up, and a URL that differs
     * only in its fragment never triggers one. Polling the document's own boot
     * payload is what turns an edited UI into a phone that updates itself, instead
     * of waiting for someone to pull to refresh.
     * @param booted - the revision this document loaded with.
     */
    async function checkForReload(booted) {
      try {
        const response = await fetch('./', { cache: 'no-store', headers: { accept: 'text/html' } })
        if (response.ok !== true) return
        const match = /__DSH_BOOT__\D*\{\s*"rev":"([^"]+)"/.exec(await response.text())
        if (match !== null && match[1] !== booted) location.reload()
      } catch {
        /* offline or refused: the next tick tries again */
      }
    }

    /**
     * Opt-in diagnostics, mirroring the Host's injected script: the numbers that
     * make a phone screenshot actionable. It lives here as well because the Host row
     * needs a restart, and because activating it by editing only the fragment does
     * not reload the page — so this also listens for `hashchange`.
     * @returns the readout, or null while the fragment does not ask for it.
     */
    function MobileDebug() {
      const [asked, setAsked] = React.useState(() => location.hash.includes('mobile-debug'))
      const [line, setLine] = React.useState('')
      React.useEffect(() => {
        const sync = () => {
          setAsked(location.hash.includes('mobile-debug'))
        }
        window.addEventListener('hashchange', sync)
        return () => {
          window.removeEventListener('hashchange', sync)
        }
      }, [])
      React.useEffect(() => {
        if (!asked) return undefined
        // The probe reports what this document actually resolved: every inset is
        // 0px until the viewport meta carries viewport-fit=cover.
        const probe = document.createElement('div')
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
        document.body.appendChild(probe)
        const insets = () => {
          const resolved = getComputedStyle(probe)
          return [resolved.paddingTop, resolved.paddingRight, resolved.paddingBottom, resolved.paddingLeft].join('/')
        }
        const draw = () => {
          const widths = ['_frame', '_sidebarCol', '_centerCol', '_rightbarCol'].map((suffix) => {
            const node = document.querySelector(`[class$="${suffix}"], [class*="${suffix} "]`)
            const width = node === null ? '-' : String(Math.round(node.getBoundingClientRect().width))
            return `${suffix.replace(/_/g, '')}=${width}`
          })
          const meta = document.querySelector('meta[name="viewport"]')
          const fit = meta !== null && (meta.getAttribute('content') ?? '').includes('viewport-fit=cover')
          setLine(`w=${window.innerWidth} dpr=${window.devicePixelRatio} narrow=${String(window.matchMedia('(max-width: 820px)').matches)} coarse=${String(window.matchMedia('(pointer: coarse)').matches)} fit=${String(fit)} insets=${insets()} | ${widths.join(' ')}`)
        }
        draw()
        const observer = new ResizeObserver(draw)
        observer.observe(document.documentElement)
        window.addEventListener('resize', draw)
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', draw)
          probe.remove()
        }
      }, [asked])
      if (!asked) return null
      return h('div', { style: styles.debugBar }, line)
    }

    //#endregion
    /**
     * Register the independent LAN section, the row's configuration page, and the
     * settings tab.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-no-token: dictionaries')
      shared.t = t

      // The independent settings entry: its own page in the settings panel, one
      // click to bind every interface. It does not hang off this row's Config
      // form, because it edits a different row — the web server's bind.
      const store = createLanStore((options) => fetch(LAN_PATH, {
        method: options.method,
        headers: options.body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        ...options.body === undefined ? {} : { body: options.body },
      }))
      shared.lan = store
      ctx.effect(() => {
        store.refresh()
        return () => {
          shared.lan = undefined
        }
      }, 'dsh-no-token: LAN state')
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'no-token-lan',
        order: 25,
        label: () => t('lanNav'),
        locale: NS,
        inject: () => ({ store }),
      }, LanSection)), 'dsh-no-token: LAN section')

      // The Host injects the same stylesheet into the document head, where it
      // reaches a phone at first paint even through a cached document. This seat is
      // the fallback: it renders nothing while the Host's copy is already present.
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'no-token-mobile',
        order: 1000,
      }, MobileStyle)), 'dsh-no-token: mobile stylesheet')

      // The readout sits above everything and takes no pointer events.
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'no-token-mobile-debug',
        order: 1001,
      }, MobileDebug)), 'dsh-no-token: mobile readout')

      // Safe-area insets only resolve once the document asks for `cover`; the Host
      // sets it in the served document, and this covers a page loaded before it did.
      ctx.effect(() => applyMobileViewport(), 'dsh-no-token: mobile viewport')

      // A changed module is a changed URL; this is what makes a reload happen
      // without being asked for one. It only fires while the page is in the
      // background: reloading a visible page would throw a draft away mid-sentence,
      // and nobody minds a fresh build waiting for the moment they look away.
      ctx.effect(() => {
        const booted = bootedRevision()
        if (booted === undefined) return () => {}
        const timer = setInterval(() => {
          if (document.visibilityState !== 'hidden') return
          void checkForReload(booted)
        }, 300000)
        return () => {
          clearInterval(timer)
        }
      }, 'dsh-no-token: reload watcher')

      // Registered only while the Host serves this row's form, so a profile
      // without the row (or with it disabled) shows no trace of the page.
      ctx.effect(() => ctx.configForms.whileServed(ENTRIES, (served) => {
        const entry = ENTRIES.find((candidate) => served.has(candidate))
        if (entry === undefined) return () => {}
        const controller = ctx.configForms.get(entry)
        shared.controller = controller
        const inject = () => ({ controller })

        // Seat 1: the row a bundle declares, in the sidebar Plugins page. Its
        // presence is what gives the row a configure control, and its
        // `view: 'summary'` render is the row's one-liner.
        const rowPage = ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
          locale: NS,
          inject,
        }, NoTokenCard))

        // Seat 2: a tab inside Settings → Built-in plugins, which is where a
        // user looks for a plugin's configuration. The seat is additive by
        // design ("a fresh id is added beside the shipped entries"), and the
        // section renders this entry's `label` as the tab text.
        const settingsTab = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'no-token',
          order: 20,
          label: () => t('title'),
          locale: NS,
          inject,
        }, NoTokenCard))

        // Seat 3: the bundle's own configuration on its card page, between the
        // description and the rows — opening the card is then enough.
        const bundleConfig = ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-no-token',
          locale: NS,
          inject,
        }, NoTokenCard))

        return () => {
          rowPage?.()
          settingsTab?.()
          bundleConfig?.()
          controller.dispose()
          shared.controller = undefined
        }
      }), 'dsh-no-token: configuration page')
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply,
    }
  },
})
