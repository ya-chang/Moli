// dark-theme.js
// 暗黑主题插件 — 一键切换暗黑风格
// 作者：拟恋社区
// 版本：2.0.0

module.exports = {
  meta: {
    id: 'dark-theme',
    name: '暗黑主题',
    version: '2.0.0',
    author: '拟恋社区',
    description: '拟恋暗黑主题，护眼又好看',
    type: 'normal',
    scope: 'global',
    priority: 100,
    permissions: ['ui.theme'],

    configSchema: [
      {
        key: 'accentColor',
        label: '强调色',
        type: 'color',
        default: '#e94560',
        placeholder: '选择强调色'
      },
      {
        key: 'bgOpacity',
        label: '背景透明度',
        type: 'select',
        options: [
          { label: '完全不透明', value: '1' },
          { label: '轻微透明', value: '0.95' },
          { label: '半透明', value: '0.9' }
        ],
        default: '1'
      }
    ]
  },

  install(app) {
    app.data.pluginSet('dark-theme', 'config', {
      accentColor: '#e94560',
      bgOpacity: '1'
    })
  },

  enable(app) {
    const config = app.config.get()
    const accent = config.accentColor || '#e94560'
    const opacity = config.bgOpacity || '1'

    const css = `
      :root {
        --bg-primary: #1a1a2e;
        --bg-secondary: #16213e;
        --bg-nav: #0f3460;
        --bg-nav-hover: #1a4a7a;
        --bg-nav-active: #1a5a8a;
        --text-primary: #e0e0e0;
        --text-secondary: #808080;
        --border-color: #2a2a4a;
        --bubble-self: #0f3460;
        --bubble-other: #1a1a2e;
        --primary-color: ${accent};
        --primary-hover: ${accent}cc;
        --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.3);
        --shadow-medium: 0 2px 8px rgba(0, 0, 0, 0.4);
      }

      .chat-window, .chat-list, .settings-panel, .plugin-panel {
        background: rgba(26, 26, 46, ${opacity}) !important;
      }

      .message-bubble--other {
        background: #1a1a2e !important;
        color: #e0e0e0 !important;
      }

      .message-bubble--self {
        background: #0f3460 !important;
        color: #e0e0e0 !important;
      }

      input, textarea, select {
        background: #16213e !important;
        color: #e0e0e0 !important;
        border-color: #2a2a4a !important;
      }

      input:focus, textarea:focus {
        border-color: ${accent} !important;
      }

      .side-nav {
        background: #0f3460 !important;
      }

      ::-webkit-scrollbar {
        width: 6px;
      }

      ::-webkit-scrollbar-track {
        background: #16213e;
      }

      ::-webkit-scrollbar-thumb {
        background: #2a2a4a;
        border-radius: 3px;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: #3a3a5a;
      }
    `

    app.ui.injectCSS(css)
    app.ui.toast('暗黑主题已启用')
  },

  disable(app) {
    app.ui.injectCSS('')
    app.ui.toast('暗黑主题已禁用')
  },

  uninstall(app) {}
}
