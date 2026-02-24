const DEFAULT_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
const DEFAULT_OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
const DEFAULT_OPENAI_TOPIC_MODEL = process.env.OPENAI_TOPIC_MODEL || 'gpt-4.1-mini'
const DEFAULT_IMAGE_ATTEMPTS = Number(process.env.GEMINI_IMAGE_ATTEMPTS || '1')
const DEFAULT_IMAGE_CONCURRENCY = Number(process.env.GEMINI_IMAGE_CONCURRENCY || '4')
const DEFAULT_OPENAI_IMAGE_ATTEMPTS = Number(process.env.OPENAI_IMAGE_ATTEMPTS || '1')
const DEFAULT_OPENAI_IMAGE_CONCURRENCY = Number(process.env.OPENAI_IMAGE_CONCURRENCY || '8')
const VERBOSE_SHEET_LOGS = String(process.env.VERBOSE_SHEET_LOGS || '1') !== '0'

const TEXT_MODEL_FALLBACK_ORDER = ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']

function normalizeModelName(rawModelName) {
  const trimmed = String(rawModelName || '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

function normalizeImageModelName(rawModelName) {
  const normalized = normalizeModelName(rawModelName)
  const aliasMap = {
    'gemini-2.5-flash-preview-image': 'gemini-2.5-flash-image',
    'gemini-3-pro-image': 'gemini-3-pro-image-preview',
  }

  return aliasMap[normalized] || normalized
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)))
}

function logVerbose(requestId, stage, payload = null) {
  if (!VERBOSE_SHEET_LOGS) {
    return
  }

  const prefix = `[sheet:${requestId}] ${stage}`
  if (payload && typeof payload === 'object') {
    console.info(prefix, payload)
    return
  }

  if (payload !== null && payload !== undefined) {
    console.info(prefix, String(payload))
    return
  }

  console.info(prefix)
}

function normalizeImageProvider(rawProvider, openAiApiKey) {
  const normalized = String(rawProvider || '').trim().toLowerCase()

  if (normalized === 'gemini' || normalized === 'openai') {
    return normalized
  }

  return openAiApiKey ? 'openai' : 'gemini'
}

function toBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const rounded = Math.floor(parsed)
  return Math.max(min, Math.min(max, rounded))
}

function buildPairsPrompt(language, pairCount, topic) {
  return [
    'You create printable phonics worksheets for children aged 6 to 8.',
    `Generate exactly ${pairCount} rhyming pairs (${pairCount * 2} total words).`,
    `Target language: ${language}.`,
    `Theme for vocabulary: ${topic || 'animals and everyday objects'}.`,
    '',
    'Return JSON only with this exact shape:',
    '{',
    '  "title": "short worksheet title",',
    '  "instruction": "single sentence instruction for the child",',
    '  "language": "language name",',
    '  "pairs": [',
    '    {',
    '      "rhymeSound": "rhyme ending label",',
    '      "leftWord": "noun",',
    '      "rightWord": "noun"',
    '    }',
    '  ]',
    '}',
    '',
    'Requirements:',
    '- Words must be concrete, child-friendly nouns and should rhyme clearly in the target language.',
    '- Keep words short when possible and avoid offensive or abstract vocabulary.',
    '- Avoid duplicates across all words in the worksheet.',
    '- Do not include markdown fences or explanations, output JSON only.',
  ].join('\n')
}

function buildRandomTopicPrompt(language, currentTopic) {
  return [
    'Generate one fresh worksheet topic for children aged 6-8.',
    `Target language: ${language}.`,
    currentTopic ? `Current topic to avoid repeating: ${currentTopic}.` : 'Avoid generic repeated topics.',
    'Return JSON only:',
    '{"topic":"short topic phrase"}',
    'Rules:',
    '- 2 to 6 words.',
    '- Child-friendly nouns/domains that are easy to illustrate.',
    '- No punctuation-heavy formatting.',
    '- Keep it broad enough for rhyming noun pairs.',
  ].join('\n')
}

function buildImagePrompt(word, language, topic, variationHint = '') {
  return [
    `Create one polished children's educational clipart icon for the word "${word}" in ${language}.`,
    `Worksheet topic context: ${topic || 'animals and everyday objects'}.`,
    variationHint
      ? `Create a noticeably different variation than previous versions. Variation hint: ${variationHint}.`
      : 'Create a distinct icon composition and silhouette.',
    'Output requirements:',
    '- Depict exactly the requested word as one centered object.',
    '- Plain white background only (no transparency).',
    '- No checkerboard/alpha-grid background and no black background.',
    '- No scene, no frame, no border, no collage, no text, no watermark.',
    '- Child-friendly flat vector-like clipart style with clean outlines and consistent colors.',
    '- Make the object large: occupy about 80% to 90% of canvas area.',
    '- Keep full object visible with clear margin from image edges.',
    '- 1:1 composition.',
  ].join('\n')
}

function buildAlternativeWordPrompt({ currentWord, pairedWord, language, topic }) {
  return [
    `Target language: ${language}.`,
    `Topic context: ${topic || 'animals and everyday objects'}.`,
    `Current worksheet pair contains "${currentWord}" and "${pairedWord}".`,
    `Return one new noun that rhymes with "${pairedWord}" and is different from "${currentWord}".`,
    'Return JSON only:',
    '{"word":"new noun"}',
    'Rules:',
    '- One concrete, child-friendly noun.',
    '- Keep it short and easy to draw.',
    '- No punctuation-only output.',
    '- Avoid returning the original word.',
    '- No markdown, no extra text.',
  ].join('\n')
}

function extractJsonText(rawText) {
  const trimmed = String(rawText || '').trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (fenced && fenced[1]) {
    return fenced[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  throw new Error('Could not parse JSON from the model response.')
}

function cleanWord(rawWord) {
  if (typeof rawWord !== 'string') {
    return 'word'
  }

  const cleaned = rawWord
    .trim()
    .replace(/[\d_]/g, '')
    .replace(/[^\p{L}\p{M}\s'’-]/gu, '')
    .replace(/\s+/g, ' ')

  return cleaned || 'word'
}

function normalizeWordWorksheet(candidate, language, pairCount) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Model returned an unexpected worksheet format.')
  }

  const raw = candidate
  const rawPairs = Array.isArray(raw.pairs) ? raw.pairs : []

  if (rawPairs.length < pairCount) {
    throw new Error(`Model returned only ${rawPairs.length} pairs. Try regenerate.`)
  }

  const pairs = rawPairs.slice(0, pairCount).map((entry, index) => {
    const pair = entry || {}

    return {
      rhymeSound:
        typeof pair.rhymeSound === 'string' && pair.rhymeSound.trim()
          ? pair.rhymeSound.trim()
          : `pair ${index + 1}`,
      left: {
        word: cleanWord(pair.leftWord || (pair.left && pair.left.word)),
      },
      right: {
        word: cleanWord(pair.rightWord || (pair.right && pair.right.word)),
      },
    }
  })

  return {
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : `${language} Rhyming Match Sheet`,
    instruction:
      typeof raw.instruction === 'string' && raw.instruction.trim()
        ? raw.instruction.trim()
        : 'Draw a line between words that rhyme.',
    language:
      typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : language,
    pairs,
  }
}

function parseRetrySeconds(errorMessage) {
  const match = String(errorMessage).match(/retry in\s*([\d.]+)s/i)
  if (!match || !match[1]) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? Math.ceil(parsed) : null
}

function isRetryableModelError(status, errorMessage) {
  const lowerMessage = String(errorMessage || '').toLowerCase()

  if (/api key|unauthorized|forbidden|permission denied|billing account/i.test(lowerMessage)) {
    return false
  }

  if (status >= 500) {
    return true
  }

  return /not found|not supported|unsupported|quota exceeded|rate limit|resource exhausted|limit:\s*0|retry in/i.test(lowerMessage)
}

function humanizeGeminiError(errorMessage, triedModels) {
  const lowerMessage = String(errorMessage || '').toLowerCase()

  if (/limit:\s*0/.test(lowerMessage)) {
    return `The API project for this key has model entitlement set to 0 ("limit: 0"). This is usually a project/billing-tier configuration issue, not normal daily usage. Try model gemini-2.5-flash and gemini-2.5-flash-image, or enable paid access on the same Google project as this key. Tried models: ${triedModels.join(', ')}.`
  }

  if (/quota exceeded|rate limit|resource exhausted/.test(lowerMessage)) {
    const retrySeconds = parseRetrySeconds(errorMessage)
    return retrySeconds
      ? `Gemini throttled this request. Retry in about ${retrySeconds}s. Tried models: ${triedModels.join(', ')}.`
      : `Gemini throttled this request. Tried models: ${triedModels.join(', ')}.`
  }

  return `${errorMessage || 'Unknown Gemini API error.'} Tried models: ${triedModels.join(', ')}.`
}

function summarizeImageError(errorMessage) {
  const message = String(errorMessage || '')
  const lowerMessage = message.toLowerCase()

  if (/limit:\s*0/.test(lowerMessage)) {
    return 'Image model entitlement is 0 for this project/key (not normal daily usage).'
  }

  if (/quota exceeded|rate limit|resource exhausted/.test(lowerMessage)) {
    const retrySeconds = parseRetrySeconds(message)
    return retrySeconds
      ? `Image model throttled. Retry in about ${retrySeconds}s.`
      : 'Image model throttled this request.'
  }

  return message.slice(0, 220)
}

function summarizeMissingImageReasons(imageResults) {
  return imageResults
    .filter((item) => item && (!item.image || !item.image.imageDataUrl))
    .slice(0, 3)
    .map((item) =>
      `${item.word}: ${summarizeImageError(item.image && item.image.error ? item.image.error : 'no image returned')}`,
    )
}

function collectImageFailureDiagnostics(imageResults) {
  return imageResults
    .filter((item) => item && (!item.image || !item.image.imageDataUrl))
    .slice(0, 5)
    .map((item) => ({
      word: item.word,
      error: item.image && item.image.error ? String(item.image.error) : 'no image returned',
      attempts: item.image && Array.isArray(item.image.debugAttempts) ? item.image.debugAttempts.slice(-3) : [],
    }))
}

async function callGeminiModel({ apiKey, model, body }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  const payload = await response.json().catch(() => null)

  return { response, payload }
}

async function callOpenAiImageModel({ apiKey, model, prompt }) {
  const outputFormat = String(process.env.OPENAI_IMAGE_FORMAT || 'jpeg').trim().toLowerCase()
  const imageSize = String(process.env.OPENAI_IMAGE_SIZE || '512x512').trim() || '512x512'
  const imageQuality = String(process.env.OPENAI_IMAGE_QUALITY || 'low').trim().toLowerCase() || 'low'

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size: imageSize,
      quality: imageQuality,
      output_format: outputFormat,
      background: 'opaque',
    }),
  })

  const payload = await response.json().catch(() => null)

  return { response, payload, outputFormat }
}

async function callOpenAiTextModel({ apiKey, model, prompt }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You produce concise structured JSON for children worksheet planning. Output valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => null)
  return { response, payload }
}

function extractTextFromPayload(payload) {
  return (payload && payload.candidates ? payload.candidates : [])
    .flatMap((candidate) => (candidate && candidate.content && candidate.content.parts ? candidate.content.parts : []))
    .map((part) => (part && part.text ? part.text : ''))
    .join('')
    .trim()
}

function extractImageDataFromPayload(payload) {
  const parts = (payload && payload.candidates ? payload.candidates : []).flatMap((candidate) =>
    candidate && candidate.content && candidate.content.parts ? candidate.content.parts : [],
  )

  for (const part of parts) {
    const inlineData = part && (part.inlineData || part.inline_data)
    if (!inlineData || !inlineData.data) {
      continue
    }

    const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png'
    if (!String(mimeType).startsWith('image/')) {
      continue
    }

    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${inlineData.data}`,
    }
  }

  for (const part of parts) {
    const fileData = part && (part.fileData || part.file_data)
    const uri = fileData && fileData.fileUri
    const mimeType = fileData && (fileData.mimeType || fileData.mime_type)
    if (uri && mimeType && String(mimeType).startsWith('image/')) {
      return {
        mimeType,
        dataUrl: String(uri),
      }
    }
  }

  return null
}

function extractImageDataFromOpenAiPayload(payload, outputFormat) {
  const first = payload && Array.isArray(payload.data) ? payload.data[0] : null
  if (!first) {
    return null
  }

  if (first.b64_json) {
    const mimeType = outputFormat === 'png' ? 'image/png' : 'image/jpeg'
    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${first.b64_json}`,
    }
  }

  if (first.url && /^https?:\/\//i.test(String(first.url))) {
    return {
      mimeType: 'image/png',
      dataUrl: String(first.url),
    }
  }

  return null
}

async function generateWordWorksheet({ apiKey, language, pairCount, topic, candidateModels }) {
  let lastErrorMessage = ''
  let lastStatus = 500

  for (const modelName of candidateModels) {
    const { response, payload } = await callGeminiModel({
      apiKey,
      model: modelName,
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: buildPairsPrompt(language, pairCount, topic),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      },
    })

    if (!response.ok) {
      const errorMessage = payload && payload.error && payload.error.message
        ? payload.error.message
        : `Gemini API request failed (${response.status}).`

      lastErrorMessage = errorMessage
      lastStatus = response.status

      if (isRetryableModelError(response.status, errorMessage)) {
        continue
      }

      throw new Error(humanizeGeminiError(errorMessage, [modelName]))
    }

    try {
      const modelText = extractTextFromPayload(payload)
      if (!modelText) {
        throw new Error('Gemini did not return worksheet content.')
      }

      const worksheetJson = JSON.parse(extractJsonText(modelText))
      const worksheet = normalizeWordWorksheet(worksheetJson, language, pairCount)

      return {
        worksheet,
        usedModel: modelName,
      }
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : 'Invalid JSON returned from model.'
      lastStatus = 502
    }
  }

  throw new Error(humanizeGeminiError(lastErrorMessage, candidateModels))
}

async function generateAlternativeWord({
  apiKey,
  currentWord,
  pairedWord,
  language,
  topic,
  candidateModels,
}) {
  const currentLower = cleanWord(currentWord).toLowerCase()

  for (const modelName of candidateModels) {
    const { response, payload } = await callGeminiModel({
      apiKey,
      model: modelName,
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: buildAlternativeWordPrompt({
                  currentWord,
                  pairedWord,
                  language,
                  topic,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.6,
        },
      },
    })

    if (!response.ok) {
      continue
    }

    try {
      const modelText = extractTextFromPayload(payload)
      if (!modelText) {
        continue
      }

      const json = JSON.parse(extractJsonText(modelText))
      const candidateWord = cleanWord(json && json.word ? json.word : '')

      if (candidateWord && candidateWord.toLowerCase() !== currentLower) {
        return candidateWord
      }
    } catch {
      continue
    }
  }

  return cleanWord(currentWord)
}

async function generateRandomTopicWithOpenAi({
  apiKey,
  model,
  language,
  currentTopic,
}) {
  const { response, payload } = await callOpenAiTextModel({
    apiKey,
    model,
    prompt: buildRandomTopicPrompt(language, currentTopic),
  })

  if (!response.ok) {
    const errorMessage =
      payload && payload.error && payload.error.message
        ? payload.error.message
        : `OpenAI topic request failed (${response.status}).`
    throw new Error(errorMessage)
  }

  const messageText =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    typeof payload.choices[0].message.content === 'string'
      ? payload.choices[0].message.content
      : ''

  if (!messageText) {
    throw new Error('OpenAI did not return topic content.')
  }

  const parsed = JSON.parse(extractJsonText(messageText))
  const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : ''

  if (!topic) {
    throw new Error('OpenAI returned an empty topic.')
  }

  return topic
}

async function generateWordImageWithGemini({
  apiKey,
  word,
  language,
  topic,
  candidateModels,
  variationHint = '',
  maxAttemptsPerModel = 1,
}) {
  let lastErrorMessage = ''
  let lastNoImageReason = ''
  const attemptErrors = []

  for (const modelName of candidateModels) {
    for (let attempt = 0; attempt < maxAttemptsPerModel; attempt += 1) {
      const { response, payload } = await callGeminiModel({
        apiKey,
        model: modelName,
        body: {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildImagePrompt(word, language, topic, variationHint),
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
            temperature: 0.2,
          },
        },
      })

      if (!response.ok) {
        const errorMessage = payload && payload.error && payload.error.message
          ? payload.error.message
          : `Gemini image request failed (${response.status}).`

        lastErrorMessage = errorMessage
        attemptErrors.push(`${modelName} (attempt ${attempt + 1}): ${errorMessage}`)

        if (isRetryableModelError(response.status, errorMessage)) {
          continue
        }

        return { error: errorMessage, debugAttempts: attemptErrors.slice(-6) }
      }

      const image = extractImageDataFromPayload(payload)
      if (image && image.dataUrl) {
        return {
          imageDataUrl: image.dataUrl,
          mimeType: image.mimeType,
          usedModel: modelName,
          debugAttempts: attemptErrors.slice(-6),
        }
      }

      const textReason = extractTextFromPayload(payload)
      if (textReason) {
        lastNoImageReason = textReason
        attemptErrors.push(
          `${modelName} (attempt ${attempt + 1}): model returned text instead of image: ${textReason.slice(0, 220)}`,
        )
      } else {
        attemptErrors.push(`${modelName} (attempt ${attempt + 1}): model returned no image data`)
      }
    }
  }

  return {
    error:
      lastErrorMessage ||
      lastNoImageReason ||
      (attemptErrors.length > 0
        ? attemptErrors.slice(-3).join(' | ')
        : 'Model returned no image data for this word.'),
    debugAttempts: attemptErrors.slice(-6),
  }
}

async function generateWordImageWithOpenAi({
  apiKey,
  word,
  language,
  topic,
  model,
  variationHint = '',
  maxAttempts = 1,
}) {
  const attemptErrors = []

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = buildImagePrompt(word, language, topic, variationHint)
    const { response, payload, outputFormat } = await callOpenAiImageModel({
      apiKey,
      model,
      prompt,
    })

    if (!response.ok) {
      const errorMessage = payload && payload.error && payload.error.message
        ? payload.error.message
        : `OpenAI image request failed (${response.status}).`
      attemptErrors.push(`openai ${model} (attempt ${attempt + 1}): ${errorMessage}`)
      if (isRetryableModelError(response.status, errorMessage)) {
        continue
      }
      return { error: errorMessage, debugAttempts: attemptErrors.slice(-6) }
    }

    const image = extractImageDataFromOpenAiPayload(payload, outputFormat)
    if (image && image.dataUrl) {
      return {
        imageDataUrl: image.dataUrl,
        mimeType: image.mimeType,
        usedModel: model,
        debugAttempts: attemptErrors.slice(-6),
      }
    }

    const payloadError = payload && payload.error && payload.error.message ? payload.error.message : 'No image returned.'
    attemptErrors.push(`openai ${model} (attempt ${attempt + 1}): ${payloadError}`)
  }

  return {
    error: attemptErrors.length > 0 ? attemptErrors.slice(-3).join(' | ') : 'OpenAI returned no image data.',
    debugAttempts: attemptErrors.slice(-6),
  }
}

async function generateWordImage({
  imageProvider,
  geminiApiKey,
  openAiApiKey,
  openAiImageModel,
  word,
  language,
  topic,
  candidateModels,
  variationHint = '',
  maxAttemptsPerModel = 1,
}) {
  if (imageProvider === 'openai' && openAiApiKey) {
    return generateWordImageWithOpenAi({
      apiKey: openAiApiKey,
      model: openAiImageModel,
      word,
      language,
      topic,
      variationHint,
      maxAttempts: maxAttemptsPerModel,
    })
  }

  return generateWordImageWithGemini({
    apiKey: geminiApiKey,
    word,
    language,
    topic,
    candidateModels,
    variationHint,
    maxAttemptsPerModel,
  })
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1

        if (index >= items.length) {
          return
        }

        results[index] = await mapper(items[index], index)
      }
    }),
  )

  return results
}

export default async function handler(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const requestStartedAt = Date.now()

  if (req.method !== 'POST') {
    logVerbose(requestId, 'reject:method', { method: req.method })
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  } catch {
    logVerbose(requestId, 'reject:invalid-json')
    return res.status(400).json({ error: 'Invalid JSON body.' })
  }

  const openAiApiKey = process.env.OPENAI_API_KEY || ''
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'English'
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  const randomizeTopic = body.randomizeTopic === true
  const deferImages = body.deferImages === true
  const parsedPairCount = Number(body.pairCount)
  const pairCount = [3, 4, 5].includes(parsedPairCount) ? parsedPairCount : 5
  const singleWordRequest = typeof body.word === 'string' ? cleanWord(body.word) : ''
  const pairedWordRequest = typeof body.pairedWord === 'string' ? cleanWord(body.pairedWord) : ''
  const replaceWord = body.replaceWord === true
  const variationHint = typeof body.variationHint === 'string' ? body.variationHint.trim() : ''
  const imageProvider = normalizeImageProvider(process.env.IMAGE_PROVIDER, openAiApiKey)
  const openAiImageModel = String(DEFAULT_OPENAI_IMAGE_MODEL || 'gpt-image-1').trim() || 'gpt-image-1'
  const openAiTopicModel = String(DEFAULT_OPENAI_TOPIC_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiImageAttempts = toBoundedInteger(DEFAULT_IMAGE_ATTEMPTS, 1, 1, 3)
  const geminiImageConcurrency = toBoundedInteger(DEFAULT_IMAGE_CONCURRENCY, 4, 1, 8)
  const openAiImageAttempts = toBoundedInteger(DEFAULT_OPENAI_IMAGE_ATTEMPTS, 1, 1, 3)
  const openAiImageConcurrency = toBoundedInteger(DEFAULT_OPENAI_IMAGE_CONCURRENCY, 8, 1, 12)
  const imageAttempts = imageProvider === 'openai' ? openAiImageAttempts : geminiImageAttempts
  const imageConcurrency = imageProvider === 'openai' ? openAiImageConcurrency : geminiImageConcurrency

  logVerbose(requestId, 'start', {
    language,
    pairCount,
    topic,
    randomizeTopic,
    deferImages,
    singleWordRequest: Boolean(singleWordRequest),
    replaceWord,
    imageProvider,
    imageConcurrency,
    imageAttempts,
  })

  if (randomizeTopic) {
    if (!openAiApiKey) {
      return res.status(500).json({ error: 'Missing server env OPENAI_API_KEY for topic randomization.' })
    }

    const topicStartedAt = Date.now()
    try {
      const nextTopic = await generateRandomTopicWithOpenAi({
        apiKey: openAiApiKey,
        model: openAiTopicModel,
        language,
        currentTopic: topic,
      })

      logVerbose(requestId, 'topic-randomized', {
        durationMs: Date.now() - topicStartedAt,
        topic: nextTopic,
      })
      return res.status(200).json({
        topic: nextTopic,
        source: `openai:${openAiTopicModel}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Topic randomization failed.'
      logVerbose(requestId, 'topic-randomize:error', {
        durationMs: Date.now() - topicStartedAt,
        error: message,
      })
      return res.status(502).json({ error: message })
    }
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || ''

  const requestedTextModel = normalizeModelName(typeof body.model === 'string' ? body.model : '')
  const textModelCandidates = unique([
    requestedTextModel || normalizeModelName(DEFAULT_TEXT_MODEL) || 'gemini-3.1-pro-preview',
    ...TEXT_MODEL_FALLBACK_ORDER,
  ])

  const requestedImageModel = normalizeImageModelName(DEFAULT_IMAGE_MODEL)
  const rawImageModelEnv = process.env.GEMINI_IMAGE_MODEL || '(unset)'
  const imageModelCandidates = unique([
    requestedImageModel || 'gemini-2.5-flash-image',
    'gemini-2.5-flash-image',
  ])

  if (singleWordRequest) {
    const singleStartedAt = Date.now()
    let targetWord = singleWordRequest
    const needsGeminiText = replaceWord && Boolean(pairedWordRequest)
    const usesOpenAiImages = imageProvider === 'openai' && Boolean(openAiApiKey)
    const needsGeminiImage = !usesOpenAiImages

    if ((needsGeminiText || needsGeminiImage) && !geminiApiKey) {
      return res.status(500).json({
        error:
          'Missing server env GEMINI_API_KEY. It is required for replace-word generation and Gemini image provider.',
      })
    }

    if (replaceWord && pairedWordRequest) {
      targetWord = await generateAlternativeWord({
        apiKey: geminiApiKey,
        currentWord: singleWordRequest,
        pairedWord: pairedWordRequest,
        language,
        topic,
        candidateModels: textModelCandidates,
      })
    }

    const image = await generateWordImage({
      imageProvider,
      geminiApiKey,
      openAiApiKey,
      openAiImageModel,
      word: targetWord,
      language,
      topic,
      candidateModels: imageModelCandidates,
      variationHint,
      maxAttemptsPerModel: Math.max(2, imageAttempts),
    })

    if (image && image.imageDataUrl) {
      logVerbose(requestId, 'single-word:done', {
        word: targetWord,
        durationMs: Date.now() - singleStartedAt,
        provider: imageProvider,
        model: image.usedModel || '(unknown)',
      })
      return res.status(200).json({
        word: targetWord,
        imageDataUrl: image.imageDataUrl,
        mimeType: image.mimeType || 'image/png',
        provider: image.usedModel || 'gemini-image',
      })
    }

    return res.status(502).json({
      error: `Unable to generate an alternative image for "${targetWord}". ${summarizeImageError(
        image && image.error ? image.error : 'no image returned',
      )}`,
      imageDiagnostics: {
        imageProvider,
        openAiImageModel,
        rawImageModelEnv,
        normalizedImageModel: requestedImageModel,
        imageModelCandidates,
        imageAttempts,
        imageConcurrency,
        sampleAttempts:
          image && Array.isArray(image.debugAttempts) ? image.debugAttempts.slice(-3) : [],
      },
    })
  }

  try {
    if (!geminiApiKey) {
      return res.status(500).json({
        error: 'Missing server env GEMINI_API_KEY. Worksheet word generation uses Gemini text model.',
      })
    }

    const worksheetStartedAt = Date.now()
    const { worksheet, usedModel } = await generateWordWorksheet({
      apiKey: geminiApiKey,
      language,
      pairCount,
      topic,
      candidateModels: textModelCandidates,
    })
    logVerbose(requestId, 'worksheet:words-ready', {
      durationMs: Date.now() - worksheetStartedAt,
      usedModel,
    })

    if (deferImages) {
      const emptyPairs = worksheet.pairs.map((pair) => ({
        ...pair,
        left: {
          ...pair.left,
          imageDataUrl: '',
          mimeType: '',
        },
        right: {
          ...pair.right,
          imageDataUrl: '',
          mimeType: '',
        },
      }))

      logVerbose(requestId, 'worksheet:defer-images-return', {
        totalMs: Date.now() - requestStartedAt,
        pairCount: emptyPairs.length,
      })
      return res.status(200).json({
        worksheet: {
          ...worksheet,
          pairs: emptyPairs,
        },
        usedTextModel: usedModel,
        usedImageModels: [],
        imageWarning: '',
        imageDiagnostics: null,
        deferredImages: true,
      })
    }

    const uniqueWords = unique(
      worksheet.pairs.flatMap((pair) => [pair.left.word, pair.right.word]).map((word) => cleanWord(word)),
    )

    const wordToImage = new Map()
    logVerbose(requestId, 'worksheet:image-batch-start', {
      words: uniqueWords.length,
      provider: imageProvider,
      imageConcurrency,
      imageAttempts,
    })
    const imageResults = await mapWithConcurrency(uniqueWords, imageConcurrency, async (word) => {
      const imageStartedAt = Date.now()
      const image = await generateWordImage({
        imageProvider,
        geminiApiKey,
        openAiApiKey,
        openAiImageModel,
        word,
        language,
        topic,
        candidateModels: imageModelCandidates,
        maxAttemptsPerModel: imageAttempts,
      })

      logVerbose(requestId, 'worksheet:image-word-done', {
        word,
        durationMs: Date.now() - imageStartedAt,
        ok: Boolean(image && image.imageDataUrl),
        model: image && image.usedModel ? image.usedModel : '(none)',
      })

      return { word, image }
    })

    for (const item of imageResults) {
      if (item && item.image && item.image.imageDataUrl) {
        wordToImage.set(item.word, item.image)
      }
    }

    const missingWords = uniqueWords.filter((word) => !wordToImage.has(word))
    const missingReasons = summarizeMissingImageReasons(imageResults)
    const failureDiagnostics = collectImageFailureDiagnostics(imageResults)
    logVerbose(requestId, 'worksheet:image-batch-finish', {
      totalWords: uniqueWords.length,
      missingWords: missingWords.length,
    })

    const enrichedPairs = worksheet.pairs.map((pair) => {
      const leftImage = wordToImage.get(pair.left.word)
      const rightImage = wordToImage.get(pair.right.word)

      return {
        ...pair,
        left: {
          ...pair.left,
          imageDataUrl: leftImage ? leftImage.imageDataUrl : '',
          mimeType: leftImage ? leftImage.mimeType : '',
        },
        right: {
          ...pair.right,
          imageDataUrl: rightImage ? rightImage.imageDataUrl : '',
          mimeType: rightImage ? rightImage.mimeType : '',
        },
      }
    })

    logVerbose(requestId, 'done', {
      durationMs: Date.now() - requestStartedAt,
      usedTextModel: usedModel,
      missingWords: missingWords.length,
    })
    return res.status(200).json({
      worksheet: {
        ...worksheet,
        pairs: enrichedPairs,
      },
      usedTextModel: usedModel,
      usedImageModels: imageProvider === 'openai' ? [openAiImageModel] : imageModelCandidates,
      imageWarning:
        missingWords.length > 0
          ? `Some images could not be generated (${missingWords.length}/${uniqueWords.length}). You can still print the worksheet and refresh individual cards later.${
              missingReasons.length > 0 ? ` Details: ${missingReasons.join(' || ')}` : ''
            }`
          : '',
      imageDiagnostics:
        missingWords.length > 0
          ? {
              imageProvider,
              openAiImageModel,
              rawImageModelEnv,
              normalizedImageModel: requestedImageModel,
              imageModelCandidates,
              imageAttempts,
              imageConcurrency,
              missingWords,
              sampleFailures: failureDiagnostics,
            }
          : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Worksheet generation failed.'
    logVerbose(requestId, 'error', {
      durationMs: Date.now() - requestStartedAt,
      message,
    })
    return res.status(502).json({ error: message })
  }
}
