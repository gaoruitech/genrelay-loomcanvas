export default {
  'zh-CN': {
    step: '第 1 步',
    title: '连接一个模型接入',
    lead: '画布本身不带模型。连接一个你自己的上游接入之后，就可以开始生成图片和视频；之后随时可以在设置里添加更多。',
    recommended: '推荐',
    cards: {
      gaorui: '一个 Key 即可使用多种图片、视频和对话模型，自带模型清单。',
      openai: '任何兼容 OpenAI 接口的服务：填入接口地址和 Key。',
      gemini: '使用 Google Gemini 的 API Key 直接接入。',
      other: '填入这个接入要求的信息。',
    },
    formTitle: '{name}',
    getKey: '获取 API Key',
    submit: '测试并保存',
    submitHint: '会先做一次连通性测试，通过后进入画布。',
    skip: '先跳过',
    skipHint: '稍后可以在「设置 → 模型接入」里配置。',
  },

  en: {
    step: 'Step 1',
    title: 'Connect a model provider',
    lead: 'The canvas doesn’t ship with models. Connect a provider with your own API key to start generating images and video. You can add more in Settings at any time.',
    recommended: 'Recommended',
    cards: {
      gaorui: 'One key for a range of image, video and chat models, with the model list built in.',
      openai: 'Any service that speaks the OpenAI API: enter its base URL and key.',
      gemini: 'Connect directly with a Google Gemini API key.',
      other: 'Enter the details this provider needs.',
    },
    formTitle: '{name}',
    getKey: 'Get an API key',
    submit: 'Test and save',
    submitHint: 'We’ll run a quick connection test, then take you to your canvases.',
    skip: 'Skip for now',
    skipHint: 'You can set this up later in Settings → Providers.',
  },
}
