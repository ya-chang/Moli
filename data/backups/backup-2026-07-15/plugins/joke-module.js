// joke-module.js
// 讲笑话模块 — 给指定角色添加讲笑话的能力
// 作者：拟恋社区
// 版本：1.0.0

module.exports = {
  meta: {
    id: 'joke-module',
    name: '讲笑话模块',
    version: '1.0.0',
    author: '拟恋社区',
    description: '当用户说"无聊"或"讲个笑话"时，AI会讲一个笑话',
    type: 'normal',
    scope: 'character',
    priority: 100,
    permissions: ['ai.behavior', 'api.request'],

    configSchema: [
      {
        key: 'jokeSource',
        label: '笑话来源',
        type: 'select',
        options: [
          { label: '内置笑话库', value: 'builtin' },
          { label: '在线API（需网络）', value: 'api' }
        ],
        default: 'builtin'
      },
      {
        key: 'maxPerDay',
        label: '每天最多讲几个',
        type: 'number',
        default: 10,
        min: 1,
        max: 50
      }
    ]
  },

  // 内置笑话库
  jokes: [
    { setup: '为什么程序员总是分不清万圣节和圣诞节？', punchline: '因为 Oct 31 = Dec 25。' },
    { setup: '程序员最怕什么？', punchline: '最怕改需求。' },
    { setup: '为什么程序员喜欢暗色主题？', punchline: '因为光会吸引 bug。' },
    { setup: '一个 SQL 语句走进酒吧，看到两张桌子，于是说：', punchline: '"我可以 JOIN 你们吗？"' },
    { setup: '为什么程序员总是把圣诞节和万圣节搞混？', punchline: '因为 Dec 25 = Oct 31。' },
    { setup: '程序员的妻子让他去超市：', punchline: '"买一箱牛奶，如果有鸡蛋，买六个。" 程序员回来带了六箱牛奶。"因为有鸡蛋。"' },
    { setup: '世界上最短的笑话是什么？', punchline: '一个需求文档。' },
    { setup: '为什么程序员不喜欢出门？', punchline: '因为外面没有 WiFi。' },
    { setup: '程序员的老婆让他去买菜：', punchline: '"买条鱼，如果有西瓜就买一个。" 程序员买了一条鱼。"因为没有西瓜。"' },
    { setup: '为什么程序员总是在黑暗中工作？', punchline: '因为 bug 喜欢光。' },
    { setup: '什么是程序员的浪漫？', punchline: '"我对你的爱像死循环，永远不会停。"' },
    { setup: '程序员感冒了怎么办？', punchline: '喝 Java（爪哇）咖啡。' },
    { setup: '为什么程序员总是分不清 Halloween 和 Christmas？', punchline: '因为 Oct 31 == Dec 25。' },
    { setup: '一个程序员去面试，面试官问：', punchline: '"你期望的薪资是多少？" 程序员："负一万。" 面试官："？？？" 程序员："我倒贴钱来上班，但你要让我远程。"' },
    { setup: '为什么程序员不喜欢体育运动？', punchline: '因为他们怕被 catch。' },
    { setup: '程序员的闹钟是什么？', punchline: '报错信息。' },
    { setup: '什么是程序员的噩梦？', punchline: '生产环境没有日志。' },
    { setup: '为什么程序员总是看起来很年轻？', punchline: '因为他们不做体力活。' },
    { setup: '程序员最讨厌的四件事是什么？', punchline: '别人不写文档、自己写文档、文档过时、更新文档。' },
    { setup: '为什么程序员总是很穷？', punchline: '因为他们把所有的钱都花在了 bug 上。' }
  ],

  enable(app) {
    const config = app.config.get()
    const jokeSource = config.jokeSource || 'builtin'
    const maxPerDay = config.maxPerDay || 10

    // 添加行为策略：用户无聊时讲笑话
    app.ai.addBehavior(this._characterId, {
      name: '讲笑话',
      trigger: 'user says 无聊 OR user says 讲个笑话 OR user says 讲个段子 OR user says 来个笑话',
      action: async (context) => {
        // 检查每日限制
        const today = new Date().toDateString()
        const usageKey = `joke-usage-${today}`
        const usage = await app.data.pluginGet('joke-module', usageKey, this._characterId) || { count: 0 }

        if (usage.count >= maxPerDay) {
          return '今天笑话讲太多啦，明天再讲吧~'
        }

        let joke = null

        if (jokeSource === 'api') {
          try {
            const res = await app.net.fetch('https://official-joke-api.appspot.com/random_joke')
            const data = await res.json()
            joke = { setup: data.setup, punchline: data.punchline }
          } catch {
            // fallback to builtin
          }
        }

        if (!joke) {
          // 从内置笑话库随机选一个
          joke = this.jokes[Math.floor(Math.random() * this.jokes.length)]
        }

        // 记录使用次数
        usage.count++
        await app.data.pluginSet('joke-module', usageKey, usage, this._characterId)

        return `${joke.setup}\n${joke.punchline}`
      }
    })

    // 添加 AI 能聊笑话话题
    app.ai.addPromptSection(this._characterId, `
## 笑话能力
你有一个讲笑话的模块。当用户说"无聊"、"讲个笑话"、"来个段子"时，你可以讲一个有趣的笑话。
笑话要简短有趣，不要太长。每次讲完可以问"好笑吗？"或"再来一个？"
    `.trim())

    app.ui.toast('讲笑话模块已启用')
  },

  disable(app) {
    app.ui.toast('讲笑话模块已禁用')
  },

  uninstall(app) {},

  // 框架在 enable 前注入 _characterId（character 插件专用）
  _characterId: null
}
