// weather-plugin.js
// 天气助手插件 v4.0
// 支持全球任意城市 - 用户输入什么就查什么

module.exports = {
  meta: {
    id: 'weather-plugin',
    name: '天气助手',
    version: '4.0.0',
    author: '拟恋社区',
    description: '每天启动后弹窗告知天气，支持全球任意城市，AI能聊天气',
    type: 'normal',
    scope: 'global',
    priority: 100,
    permissions: ['api.request', 'ai.prompt'],

    configSchema: [
      {
        key: 'city',
        label: '城市',
        type: 'text',
        default: '北京',
        placeholder: '输入任意城市名：北京、顺昌、Tokyo、New York、Paris...'
      },
      {
        key: 'showOnStart',
        label: '启动时弹窗',
        type: 'toggle',
        default: true
      },
      {
        key: 'addToMorning',
        label: '早安消息附带天气',
        type: 'toggle',
        default: true
      },
      {
        key: 'unit',
        label: '温度单位',
        type: 'select',
        options: [
          { label: '摄氏度', value: 'celsius' },
          { label: '华氏度', value: 'fahrenheit' }
        ],
        default: 'celsius'
      }
    ]
  },

  install(app) {
    app.data.pluginSet('weather-plugin', 'config', {
      city: '北京',
      showOnStart: true,
      addToMorning: true,
      unit: 'celsius'
    });
    app.data.pluginSet('weather-plugin', 'cache', null);
  },

  async enable(app) {
    const config = app.config.get();
    const city = config.city || '北京';
    const showOnStart = config.showOnStart !== false;
    const addToMorning = config.addToMorning !== false;
    const unit = config.unit || 'celsius';

    const result = await this.fetchWeather(app, city, unit);

    if (result.error) {
      if (showOnStart) {
        app.ui.modal({
          title: '⚠️ 天气助手',
          content: `${result.message}\n\n${result.suggestion || '请在插件设置中修改城市名'}`,
          buttons: ['去设置', '知道了']
        }).then(response => {
          if (response === 0) {
            app.ui.openPluginSettings('weather-plugin');
          }
        });
      }
    } else {
      if (showOnStart) {
        this.showWeatherPopup(app, result);
      }

      if (addToMorning) {
        this.morningListener = async (data) => {
          data.extra = `今天天气：${result.condition} ${result.temp}，${result.humidity}，${result.wind}`;
        };
        app.events.on('proactive:morning', this.morningListener);
      }

      app.ai.addGlobalPromptSection(`
## 用户所在城市天气
城市：${result.city}
天气：${result.condition} ${result.temp}
体感：${result.feelsLike}
湿度：${result.humidity}
风速：${result.wind}
今日温度：${result.minTemp} ~ ${result.maxTemp}
天气建议：${result.description}

你知道用户在${result.city}，当前天气是${result.condition}。
如果用户提到天气、出门、穿衣服等话题，可以用这些信息自然地回复。
不要每条消息都提天气，只在合适的时候提。
      `.trim());

      app.events.emit('weather:data', result);
    }
  },

  disable(app) {
    if (this.morningListener) {
      app.events.removeListener('proactive:morning', this.morningListener);
      this.morningListener = null;
    }
    app.data.pluginSet('weather-plugin', 'cache', null);
    app.ui.toast('天气助手已禁用');
  },

  uninstall(app) {},

  // ============================================================
  // 获取天气 - 支持全球任意城市
  // ============================================================
  async fetchWeather(app, city, unit) {
    // 检查缓存（1小时）
    const cache = await app.data.pluginGet('weather-plugin', 'cache');
    if (cache && cache.city === city && Date.now() - cache.timestamp < 3600000) {
      return cache.data;
    }

    const unitParam = unit === 'fahrenheit' ? '&u' : '';
    let data = null;
    let usedQuery = city;

    // 尝试列表：中文名 → 英文名 → 拼音
    const attempts = this.getSearchQueries(city);

    for (const query of attempts) {
      try {
        const url = `https://wttr.in/${encodeURIComponent(query)}?format=j1${unitParam}&lang=zh`;
        const response = await app.net.fetch(url);
        const result = await response.json();

        // 检查是否返回了有效天气数据
        if (result.current_condition && result.current_condition[0]) {
          // 检查返回的城市是否合理
          const nearest = result.nearest_area?.[0];
          const returnedCity = nearest?.areaName?.[0]?.value || '';
          const returnedCountry = nearest?.country?.[0]?.value || '';

          // 如果返回的城市跟查询差太远，跳过
          if (returnedCity && !this.isPlausibleMatch(city, returnedCity, returnedCountry)) {
            continue;
          }

          data = result;
          usedQuery = query;
          break;
        }
      } catch (err) {
        continue;
      }
    }

    if (!data) {
      return {
        error: true,
        message: `找不到"${city}"的天气`,
        suggestion: '请检查城市名是否正确。中文名、英文名、拼音都可以。'
      };
    }

    const current = data.current_condition[0];
    const today = data.weather[0];

    const weather = {
      city: city,
      condition: this.translateCondition(
        current.lang_zh?.[0]?.value || current.weatherDesc[0].value
      ),
      temp: unit === 'fahrenheit' ? `${current.temp_F}°F` : `${current.temp_C}°C`,
      feelsLike: unit === 'fahrenheit' ? `${current.FeelsLikeF}°F` : `${current.FeelsLikeC}°C`,
      humidity: `湿度${current.humidity}%`,
      wind: `风速${current.windspeedKmph}km/h ${current.winddir16Point}`,
      maxTemp: unit === 'fahrenheit' ? `${today.maxtempF}°F` : `${today.maxtempC}°C`,
      minTemp: unit === 'fahrenheit' ? `${today.mintempF}°F` : `${today.mintempC}°C`,
      uvIndex: current.uvIndex || '未知',
      visibility: current.visibility || '未知',
      description: this.getDescription(current.weatherCode)
    };

    await app.data.pluginSet('weather-plugin', 'cache', {
      city: city,
      timestamp: Date.now(),
      data: weather
    });

    return weather;
  },

  // ============================================================
  // 生成搜索查询列表（中文→英文→拼音）
  // ============================================================
  getSearchQueries(city) {
    const queries = [city]; // 先用原始输入

    // 尝试翻译成英文
    const english = this.toEnglish(city);
    if (english !== city) {
      queries.push(english);
    }

    // 尝试拼音
    const pinyin = this.toPinyin(city);
    if (pinyin !== city && pinyin !== english) {
      queries.push(pinyin);
    }

    return queries;
  },

  // ============================================================
  // 匹配验证（防止返回不相关的城市）
  // ============================================================
  isPlausibleMatch(input, returnedCity, returnedCountry) {
    const inputLower = input.toLowerCase().trim();
    const returnedLower = returnedCity.toLowerCase().trim();

    // 直接包含
    if (inputLower.includes(returnedLower) || returnedLower.includes(inputLower)) {
      return true;
    }

    // 英文名匹配
    const english = this.toEnglish(input).toLowerCase();
    if (english.includes(returnedLower) || returnedLower.includes(english)) {
      return true;
    }

    // 拼音匹配
    const pinyin = this.toPinyin(input).toLowerCase();
    if (pinyin.includes(returnedLower) || returnedLower.includes(pinyin)) {
      return true;
    }

    // 国内城市，返回的也是中国
    if (returnedCountry === 'China' && /[\u4e00-\u9fa5]/.test(input)) {
      return true; // 中文输入 + 返回中国城市 = 大概率对
    }

    return false;
  },

  // ============================================================
  // 中文 → 英文（全球主要城市）
  // ============================================================
  toEnglish(city) {
    const map = {
      // 中国 - 直辖市
      '北京':'Beijing','上海':'Shanghai','天津':'Tianjin','重庆':'Chongqing',
      // 中国 - 省会
      '广州':'Guangzhou','杭州':'Hangzhou','武汉':'Wuhan','南京':'Nanjing',
      '成都':'Chengdu','西安':'Xi\'an','长沙':'Changsha','郑州':'Zhengzhou',
      '济南':'Jinan','合肥':'Hefei','福州':'Fuzhou','南昌':'Nanchang',
      '昆明':'Kunming','贵阳':'Guiyang','南宁':'Nanning','太原':'Taiyuan',
      '石家庄':'Shijiazhuang','长春':'Changchun','哈尔滨':'Harbin','沈阳':'Shenyang',
      '兰州':'Lanzhou','西宁':'Xining','银川':'Yinchuan','呼和浩特':'Hohhot',
      '乌鲁木齐':'Urumqi','拉萨':'Lhasa','海口':'Haikou',
      // 中国 - 主要城市
      '深圳':'Shenzhen','苏州':'Suzhou','青岛':'Qingdao','大连':'Dalian',
      '厦门':'Xiamen','宁波':'Ningbo','无锡':'Wuxi','常州':'Changzhou',
      '徐州':'Xuzhou','温州':'Wenzhou','绍兴':'Shaoxing','金华':'Jinhua',
      '烟台':'Yantai','潍坊':'Weifang','临沂':'Linyi','洛阳':'Luoyang',
      '泉州':'Quanzhou','漳州':'Zhangzhou','桂林':'Guilin','柳州':'Liuzhou',
      '三亚':'Sanya','珠海':'Zhuhai','东莞':'Dongguan','佛山':'Foshan',
      '惠州':'Huizhou','中山':'Zhongshan','湛江':'Zhanjiang','汕头':'Shantou',
      // 中国 - 福建县城
      '顺昌':'Shunchang','南平':'Nanping','建瓯':'Jianou','邵武':'Shaowu',
      '武夷山':'Wuyishan','光泽':'Guangze','浦城':'Pucheng','松溪':'Songxi',
      '政和':'Zhenghe','泰宁':'Taining','将乐':'Jiangle','明溪':'Mingxi',
      '清流':'Qingliu','宁化':'Ninghua','大田':'Datian','尤溪':'Youxi',
      '沙县':'Shaxian','永安':'Yong\'an','连城':'Liancheng','长汀':'Changting',
      '上杭':'Shanghang','武平':'Wuping','永定':'Yongding','漳平':'Zhangping',
      '华安':'Hua\'an','南靖':'Nanjing','平和':'Pinghe','云霄':'Yunxiao',
      '诏安':'Zhao\'an','东山':'Dongshan','长泰':'Changtai','龙海':'Longhai',
      '漳浦':'Zhangpu','南安':'Nan\'an','安溪':'Anxi','永春':'Yongchun',
      '德化':'Dehua','惠安':'Hui\'an','泉港':'Quangang','石狮':'Shishi',
      '晋江':'Jinjiang','闽侯':'Minhou','连江':'Lianjiang','罗源':'Luoyuan',
      '闽清':'Minqing','永泰':'Yongtai','平潭':'Pingtan','福清':'Fuqing',
      '长乐':'Changle','仙游':'Xianyou',
      // 中国 - 热门县城
      '昆山':'Kunshan','义乌':'Yiwu','张家港':'Zhangjiagang','常熟':'Changshu',
      '江阴':'Jiangyin','宜兴':'Yixing','慈溪':'Cixi','余姚':'Yuyao',
      '瑞安':'Ruian','乐清':'Yueqing',
      '香格里拉':'Shangri-La','腾冲':'Tengchong','景洪':'Jinghong',
      '婺源':'Wuyuan','凤凰':'Fenghuang','阳朔':'Yangshuo',
      '九寨沟':'Jiuzhaigou','稻城':'Daocheng','康定':'Kangding',
      '敦煌':'Dunhuang','嘉峪关':'Jiayuguan',
      '都江堰':'Dujiangyan','峨眉山':'Emeishan','乐山':'Leshan',
      '张家界':'Zhangjiajie','丽江':'Lijiang','大理':'Dali',
      // 日本
      '东京':'Tokyo','大阪':'Osaka','京都':'Kyoto','横滨':'Yokohama',
      '名古屋':'Nagoya','神户':'Kobe','福冈':'Fukuoka','札幌':'Sapporo',
      '仙台':'Sendai','广岛':'Hiroshima','奈良':'Nara','冲绳':'Okinawa',
      '那霸':'Naha','长崎':'Nagasaki','鹿儿岛':'Kagoshima',
      // 韩国
      '首尔':'Seoul','釜山':'Busan','仁川':'Incheon','大邱':'Daegu',
      '光州':'Gwangju','大田':'Daejeon','济州':'Jeju','蔚山':'Ulsan',
      // 东南亚
      '曼谷':'Bangkok','清迈':'Chiangmai','普吉':'Phuket',
      '新加坡':'Singapore',
      '吉隆坡':'Kuala Lumpur','槟城':'Penang','马六甲':'Malacca',
      '雅加达':'Jakarta','巴厘岛':'Bali','泗水':'Surabaya','万隆':'Bandung',
      '河内':'Hanoi','胡志明市':'Ho Chi Minh City','岘港':'Da Nang',
      '马尼拉':'Manila','宿务':'Cebu',
      '仰光':'Yangon','金边':'Phnom Penh','暹粒':'Siem Reap','万象':'Vientiane',
      // 南亚
      '新德里':'New Delhi','孟买':'Mumbai','加尔各答':'Kolkata','班加罗尔':'Bangalore',
      '金奈':'Chennai','海得拉巴':'Hyderabad','斋浦尔':'Jaipur','阿格拉':'Agra',
      '加德满都':'Kathmandu','科伦坡':'Colombo','达卡':'Dhaka','卡拉奇':'Karachi',
      '伊斯兰堡':'Islamabad','拉合尔':'Lahore',
      // 中东
      '迪拜':'Dubai','阿布扎比':'Abu Dhabi','多哈':'Doha','利雅得':'Riyadh',
      '吉达':'Jeddah','科威特':'Kuwait City','巴林':'Bahrain',
      '伊斯坦布尔':'Istanbul','安卡拉':'Ankara','特拉维夫':'Tel Aviv',
      '耶路撒冷':'Jerusalem','贝鲁特':'Beirut','安曼':'Amman',
      '德黑兰':'Tehran','巴格达':'Baghdad',
      // 欧洲 - 西欧
      '伦敦':'London','巴黎':'Paris','柏林':'Berlin','阿姆斯特丹':'Amsterdam',
      '布鲁塞尔':'Brussels','卢森堡':'Luxembourg','日内瓦':'Geneva','苏黎世':'Zurich',
      '维也纳':'Vienna','慕尼黑':'Munich','法兰克福':'Frankfurt','汉堡':'Hamburg',
      '科隆':'Cologne','杜塞尔多夫':'Düsseldorf',
      // 欧洲 - 南欧
      '罗马':'Rome','米兰':'Milan','威尼斯':'Venice','佛罗伦萨':'Florence',
      '那不勒斯':'Naples','巴塞罗那':'Barcelona','马德里':'Madrid','里斯本':'Lisbon',
      '雅典':'Athens','塞萨洛尼基':'Thessaloniki',
      // 欧洲 - 北欧
      '斯德哥尔摩':'Stockholm','哥本哈根':'Copenhagen','奥斯陆':'Oslo',
      '赫尔辛基':'Helsinki','雷克雅未克':'Reykjavik',
      // 欧洲 - 东欧
      '莫斯科':'Moscow','圣彼得堡':'Saint Petersburg','基辅':'Kyiv',
      '华沙':'Warsaw','布拉格':'Prague','布达佩斯':'Budapest',
      '布加勒斯特':'Bucharest','索非亚':'Sofia','贝尔格莱德':'Belgrade',
      '萨格勒布':'Zagreb','卢布尔雅那':'Ljubljana',
      // 英国
      '伦敦':'London','曼彻斯特':'Manchester','伯明翰':'Birmingham',
      '利物浦':'Liverpool','爱丁堡':'Edinburgh','格拉斯哥':'Glasgow',
      '牛津':'Oxford','剑桥':'Cambridge','贝尔法斯特':'Belfast','都柏林':'Dublin',
      // 北美
      '纽约':'New York','洛杉矶':'Los Angeles','旧金山':'San Francisco',
      '芝加哥':'Chicago','华盛顿':'Washington','波士顿':'Boston',
      '迈阿密':'Miami','拉斯维加斯':'Las Vegas','西雅图':'Seattle',
      '休斯顿':'Houston','达拉斯':'Dallas','亚特兰大':'Atlanta',
      '费城':'Philadelphia','凤凰城':'Phoenix','丹佛':'Denver',
      '底特律':'Detroit','明尼阿波利斯':'Minneapolis','圣地亚哥':'San Diego',
      '夏威夷':'Hawaii','檀香山':'Honolulu','阿拉斯加':'Alaska',
      '多伦多':'Toronto','温哥华':'Vancouver','蒙特利尔':'Montreal',
      '渥太华':'Ottawa','卡尔加里':'Calgary','埃德蒙顿':'Edmonton',
      '墨西哥城':'Mexico City','坎昆':'Cancun','瓜达拉哈拉':'Guadalajara',
      // 南美
      '圣保罗':'Sao Paulo','里约热内卢':'Rio de Janeiro','布宜诺斯艾利斯':'Buenos Aires',
      '圣地亚哥':'Santiago','利马':'Lima','波哥大':'Bogota','加拉加斯':'Caracas',
      '基多':'Quito','蒙得维的亚':'Montevideo','亚松森':'Asuncion',
      // 大洋洲
      '悉尼':'Sydney','墨尔本':'Melbourne','布里斯班':'Brisbane',
      '珀斯':'Perth','阿德莱德':'Adelaide','堪培拉':'Canberra',
      '奥克兰':'Auckland','惠灵顿':'Wellington','基督城':'Christchurch',
      // 非洲
      '开罗':'Cairo','约翰内斯堡':'Johannesburg','开普敦':'Cape Town',
      '内罗毕':'Nairobi','拉各斯':'Lagos','卡萨布兰卡':'Casablanca',
      '突尼斯':'Tunis','阿尔及尔':'Algiers','亚的斯亚贝巴':'Addis Ababa',
      '达累斯萨拉姆':'Dar es Salaam','金沙萨':'Kinshasa','阿克拉':'Accra',
      // 俄罗斯
      '莫斯科':'Moscow','圣彼得堡':'Saint Petersburg','新西伯利亚':'Novosibirsk',
      '叶卡捷琳堡':'Yekaterinburg','喀山':'Kazan','索契':'Sochi',
      '海参崴':'Vladivostok','伊尔库茨克':'Irkutsk',
    };

    return map[city] || city;
  },

  // ============================================================
  // 中文 → 拼音（兜底）
  // ============================================================
  toPinyin(city) {
    const map = {
      '北京':'Beijing','上海':'Shanghai','天津':'Tianjin','重庆':'Chongqing',
      '广州':'Guangzhou','深圳':'Shenzhen','成都':'Chengdu','杭州':'Hangzhou',
      '武汉':'Wuhan','南京':'Nanjing','西安':'Xian','苏州':'Suzhou',
      '长沙':'Changsha','郑州':'Zhengzhou','青岛':'Qingdao','大连':'Dalian',
      '厦门':'Xiamen','昆明':'Kunming','哈尔滨':'Harbin','沈阳':'Shenyang',
      '济南':'Jinan','福州':'Fuzhou','合肥':'Hefei','南昌':'Nanchang',
      '贵阳':'Guiyang','南宁':'Nanning','太原':'Taiyuan','石家庄':'Shijiazhuang',
      '长春':'Changchun','呼和浩特':'Hohhot','乌鲁木齐':'Urumqi','拉萨':'Lhasa',
      '西宁':'Xining','银川':'Yinchuan','兰州':'Lanzhou','海口':'Haikou',
      '三亚':'Sanya','香港':'Hong Kong','澳门':'Macau','台北':'Taipei',
      '顺昌':'Shunchang','昆山':'Kunshan','义乌':'Yiwu','香格里拉':'Shangri-La',
      '九寨沟':'Jiuzhaigou','敦煌':'Dunhuang','丽江':'Lijiang','大理':'Dali',
      '桂林':'Guilin','张家界':'Zhangjiajie','婺源':'Wuyuan','凤凰':'Fenghuang',
      '阳朔':'Yangshuo','喀纳斯':'Kanas','稻城':'Daocheng',
      '东京':'Tokyo','首尔':'Seoul','曼谷':'Bangkok','新加坡':'Singapore',
      '纽约':'New York','伦敦':'London','巴黎':'Paris','柏林':'Berlin',
      '罗马':'Rome','悉尼':'Sydney','莫斯科':'Moscow','迪拜':'Dubai',
    };

    return map[city] || city;
  },

  // ============================================================
  // 弹窗：显示天气
  // ============================================================
  showWeatherPopup(app, weather) {
    if (!weather) return;

    const content = [
      `📍 ${weather.city}`,
      '',
      `${weather.condition}  ${weather.temp}`,
      `体感 ${weather.feelsLike}`,
      '',
      `今日 ${weather.minTemp} ~ ${weather.maxTemp}`,
      `${weather.humidity}  ${weather.wind}`,
      '',
      weather.description
    ].join('\n');

    app.ui.modal({
      title: '今日天气',
      content: content,
      buttons: ['知道了']
    });
  },

  // ============================================================
  // 翻译天气状况
  // ============================================================
  translateCondition(condition) {
    const translations = {
      'Clear':'晴','Sunny':'晴','Partly cloudy':'多云','Cloudy':'阴','Overcast':'阴',
      'Mist':'薄雾','Fog':'雾','Light rain':'小雨','Moderate rain':'中雨','Heavy rain':'大雨',
      'Light snow':'小雪','Moderate snow':'中雪','Heavy snow':'大雪',
      'Thundery outbreaks possible':'雷阵雨','Patchy rain possible':'可能有小雨',
      'Light drizzle':'毛毛雨','Moderate or heavy rain':'中到大雨','Torrential rain':'暴雨',
    };
    return translations[condition] || condition;
  },

  getDescription(code) {
    const descriptions = {
      '113':'☀️ 阳光很好，适合出门走走','116':'⛅ 多云天气，不会太晒','119':'☁️ 阴天，有点闷',
      '122':'🌫️ 雾大，出门注意安全','176':'🌦️ 可能有小雨，带把伞吧','200':'⛈️ 雷阵雨，尽量别出门',
      '227':'❄️ 下雪了，注意保暖','230':'❄️ 暴雪，注意安全','266':'🌧️ 小雨，记得带伞',
      '296':'🌧️ 小雨，记得带伞','302':'🌧️ 大雨，尽量别出门','305':'🌧️ 暴雨，注意安全',
      '353':'🌦️ 阵雨，带把伞吧','386':'⛈️ 雷阵雨，注意安全',
    };
    return descriptions[code] || '记得看天气预报~';
  },

  morningListener: null
};
