// src/main/knowledge/TopicClassifier.ts
// 话题分类器 — 根据用户输入匹配相关记忆类别

const TOPIC_KEYWORDS: Record<string, string[]> = {
  food: ['吃', '饭', '美食', '餐厅', '饿', '火锅', '外卖', '早餐', '午餐', '晚餐', '零食', '水果', '做饭', '厨'],
  music: ['歌', '音乐', '听', '演唱会', '歌手', '专辑', '旋律', '歌词', 'DJ', '钢琴', '吉他'],
  game: ['游戏', '上分', '排位', '开黑', 'LOL', '王者', '原神', '吃鸡', '电竞', '打游戏'],
  date: ['生日', '纪念日', '节日', '周年', '情人节', '圣诞', '元旦', '过年'],
  memory: ['以前', '之前', '记得', '那次', '还记得', '上次', '从前', '过去'],
  emotion: ['不开心', '难过', '委屈', '累', '伤心', '失望', '郁闷', '心烦', '压力大'],
  anger: ['生气', '烦', '滚', '别理我', '讨厌', '愤怒', '气死', '烦死'],
  hobby: ['喜欢', '爱好', '兴趣', '平时', '周末', '休闲', '无聊'],
  work: ['工作', '上班', '加班', '老板', '同事', '面试', '升职', '项目', '开会'],
  travel: ['旅行', '旅游', '出去玩', '度假', '景点', '酒店', '机票'],
  movie: ['电影', '电视剧', '综艺', '追剧', '看剧', '导演', '演员'],
  pet: ['猫', '狗', '宠物', '猫猫', '狗狗', '养'],
  sleep: ['睡觉', '失眠', '晚安', '早安', '熬夜', '困', '做梦'],
}

export type Topic = keyof typeof TOPIC_KEYWORDS

export class TopicClassifier {
  /**
   * 分类用户输入的话题
   * @returns 匹配到的话题类别列表
   */
  classify(text: string): Topic[] {
    const lowerText = text.toLowerCase()
    const matched: Topic[] = []

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      if (keywords.some(kw => lowerText.includes(kw))) {
        matched.push(topic as Topic)
      }
    }

    return matched
  }

  /**
   * 检查是否触发回忆检索
   */
  isRecallTrigger(text: string): boolean {
    const recallKeywords = TOPIC_KEYWORDS.memory
    return recallKeywords.some(kw => text.includes(kw))
  }

  /**
   * 检查是否触发雷区
   */
  isTabooTrigger(text: string, taboos: string[]): boolean {
    return taboos.some(taboo => text.includes(taboo))
  }
}
