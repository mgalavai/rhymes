const DEFAULT_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'

const TEXT_MODEL_FALLBACK_ORDER = ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']
const EMOJI_FALLBACK = '🧸'
const TWEMOJI_PNG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72'

const WORD_TO_EMOJI_HINTS = {
  cat: '🐱',
  dog: '🐶',
  fox: '🦊',
  frog: '🐸',
  bear: '🐻',
  hen: '🐔',
  chicken: '🐔',
  bee: '🐝',
  goat: '🐐',
  fish: '🐟',
  duck: '🦆',
  mouse: '🐭',
  rat: '🐭',
  rabbit: '🐰',
  hare: '🐰',
  pig: '🐷',
  cow: '🐮',
  horse: '🐴',
  lion: '🦁',
  tiger: '🐯',
  monkey: '🐵',
  sheep: '🐑',
  bird: '🐦',
  hat: '🧢',
  cap: '🧢',
  pen: '🖊️',
  pencil: '✏️',
  book: '📘',
  box: '📦',
  log: '🪵',
  chair: '🪑',
  table: '🪑',
  house: '🏠',
  home: '🏠',
  tree: '🌳',
  flower: '🌸',
  sun: '☀️',
  moon: '🌙',
  star: '⭐',
  boat: '⛵',
  ship: '🚢',
  car: '🚗',
  bus: '🚌',
  truck: '🚚',
  train: '🚂',
  bike: '🚲',
  ball: '⚽',
  cup: '🥤',
  mug: '☕',
  cake: '🍰',
  bread: '🍞',
  apple: '🍎',
  pear: '🍐',
  grape: '🍇',
  banana: '🍌',
  orange: '🍊',
  peach: '🍑',
}

function normalizeModelName(rawModelName) {
  const trimmed = String(rawModelName || '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)))
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

function buildImagePrompt(word, language, topic) {
  return [
    `Create one polished children's clipart icon for the word "${word}" in ${language}.`,
    `Worksheet topic context: ${topic || 'animals and everyday objects'}.`,
    'Output requirements:',
    '- Isolated single object only, transparent background.',
    '- No scene, no frame, no text, no watermark.',
    '- Child-friendly educational icon style, clean edges, centered object.',
    '- Keep full object visible with margin from image edges.',
    '- 1:1 composition.',
  ].join('\n')
}

function buildEmojiMapPrompt(words, language, topic) {
  return [
    `For each ${language} word below, choose one representative emoji for a child worksheet.`,
    `Topic context: ${topic || 'animals and everyday objects'}.`,
    'Return JSON only:',
    '{"items":[{"word":"cat","emoji":"🐱"}]}',
    'Rules:',
    '- Use exactly one emoji per word.',
    '- Keep the same words and order.',
    '- No markdown, no extra text.',
    `Words: ${words.join(', ')}`,
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

function emojiToTwemojiFilename(emoji) {
  return Array.from(String(emoji))
    .map((char) => char.codePointAt(0).toString(16))
    .join('-')
    .replace(/-fe0f/g, '')
}

function guessEmojiForWord(word) {
  const lowerWord = cleanWord(word).toLowerCase()
  const direct = WORD_TO_EMOJI_HINTS[lowerWord]
  if (direct) {
    return direct
  }

  const fragmentMatch = Object.entries(WORD_TO_EMOJI_HINTS).find(([fragment]) =>
    lowerWord.includes(fragment),
  )
  if (fragmentMatch) {
    return fragmentMatch[1]
  }

  return EMOJI_FALLBACK
}

async function fetchImageAsDataUrl(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }

    const mimeType = response.headers.get('content-type') || 'image/png'
    const imageBuffer = Buffer.from(await response.arrayBuffer())
    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`
  } catch {
    return null
  }
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
    const modelMatch = message.match(/model:\s*([a-z0-9.-]+)/i)
    const modelName = modelMatch && modelMatch[1] ? modelMatch[1] : 'selected image model'
    return `Model entitlement is 0 for ${modelName} in this project/key (not normal daily usage).`
  }

  if (/quota exceeded|rate limit|resource exhausted/.test(lowerMessage)) {
    const retrySeconds = parseRetrySeconds(message)
    return retrySeconds
      ? `Image model throttled. Retry in about ${retrySeconds}s.`
      : 'Image model throttled this request.'
  }

  return message.slice(0, 220)
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

async function generateWordImage({ apiKey, word, language, topic, candidateModels }) {
  let lastErrorMessage = ''
  let lastNoImageReason = ''
  const attemptErrors = []

  for (const modelName of candidateModels) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { response, payload } = await callGeminiModel({
        apiKey,
        model: modelName,
        body: {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: buildImagePrompt(word, language, topic),
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
            temperature: 0.4,
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

        return { error: errorMessage }
      }

      const image = extractImageDataFromPayload(payload)
      if (image && image.dataUrl) {
        return {
          imageDataUrl: image.dataUrl,
          mimeType: image.mimeType,
          usedModel: modelName,
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
  }
}

async function generateEmojiMap({ apiKey, words, language, topic, candidateModels }) {
  for (const modelName of candidateModels) {
    const { response, payload } = await callGeminiModel({
      apiKey,
      model: modelName,
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: buildEmojiMapPrompt(words, language, topic) }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      },
    })

    if (!response.ok) {
      continue
    }

    try {
      const modelText = extractTextFromPayload(payload)
      const json = JSON.parse(extractJsonText(modelText))
      const items = Array.isArray(json && json.items) ? json.items : []
      const emojiMap = new Map()

      for (const item of items) {
        const word = item && typeof item.word === 'string' ? cleanWord(item.word) : ''
        const emoji = item && typeof item.emoji === 'string' ? item.emoji.trim() : ''
        if (!word || !emoji) {
          continue
        }
        emojiMap.set(word.toLowerCase(), emoji)
      }

      return emojiMap
    } catch {
      continue
    }
  }

  return new Map()
}

async function generateEmojiFallbackImages({ apiKey, words, language, topic, candidateModels }) {
  const mappedEmojis = await generateEmojiMap({
    apiKey,
    words,
    language,
    topic,
    candidateModels,
  })

  const results = new Map()
  for (const word of words) {
    const normalizedWord = cleanWord(word)
    const emoji = mappedEmojis.get(normalizedWord.toLowerCase()) || guessEmojiForWord(normalizedWord)
    const emojiFilename = emojiToTwemojiFilename(emoji)
    const twemojiUrl = `${TWEMOJI_PNG_BASE}/${emojiFilename}.png`
    const imageDataUrl = await fetchImageAsDataUrl(twemojiUrl)
    if (!imageDataUrl) {
      continue
    }

    results.set(normalizedWord, {
      imageDataUrl,
      mimeType: 'image/png',
      provider: 'twemoji',
      emoji,
    })
  }

  return results
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing server env GEMINI_API_KEY.' })
  }

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' })
  }

  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'English'
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  const pairCount = body.pairCount === 4 ? 4 : 5

  const requestedTextModel = normalizeModelName(typeof body.model === 'string' ? body.model : '')
  const textModelCandidates = unique([
    requestedTextModel || normalizeModelName(DEFAULT_TEXT_MODEL) || 'gemini-3.1-pro-preview',
    ...TEXT_MODEL_FALLBACK_ORDER,
  ])

  const imageModelCandidates = unique([normalizeModelName(DEFAULT_IMAGE_MODEL) || 'gemini-2.5-flash-image'])

  try {
    const { worksheet, usedModel } = await generateWordWorksheet({
      apiKey,
      language,
      pairCount,
      topic,
      candidateModels: textModelCandidates,
    })

    const uniqueWords = unique(
      worksheet.pairs.flatMap((pair) => [pair.left.word, pair.right.word]).map((word) => cleanWord(word)),
    )

    const wordToImage = new Map()
    const imageResults = await mapWithConcurrency(uniqueWords, 2, async (word) => {
      const image = await generateWordImage({
        apiKey,
        word,
        language,
        topic,
        candidateModels: imageModelCandidates,
      })

      return { word, image }
    })

    for (const item of imageResults) {
      if (item && item.image && item.image.imageDataUrl) {
        wordToImage.set(item.word, item.image)
      }
    }

    const missingWords = uniqueWords.filter((word) => !wordToImage.has(word))
    if (missingWords.length > 0) {
      const emojiFallbackImages = await generateEmojiFallbackImages({
        apiKey,
        words: missingWords,
        language,
        topic,
        candidateModels: textModelCandidates,
      })

      for (const [word, image] of emojiFallbackImages.entries()) {
        wordToImage.set(word, image)
      }
    }

    const remainingMissingWords = uniqueWords.filter((word) => !wordToImage.has(word))
    if (remainingMissingWords.length > 0) {
      const missingReasons = imageResults
        .filter((item) => item && (!item.image || !item.image.imageDataUrl))
        .slice(0, 3)
        .map((item) =>
          `${item.word}: ${summarizeImageError(item.image && item.image.error ? item.image.error : 'no image returned')}`,
        )

      return res.status(502).json({
        error: `Image generation failed for: ${remainingMissingWords.join(', ')}. Verify GEMINI_IMAGE_MODEL access (recommended: gemini-2.5-flash-image). PNG emoji fallback was attempted. Details: ${missingReasons.join(' || ')}`,
      })
    }

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

    return res.status(200).json({
      worksheet: {
        ...worksheet,
        pairs: enrichedPairs,
      },
      usedTextModel: usedModel,
      usedImageModels: imageModelCandidates,
      imageFallback: 'twemoji-png',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Worksheet generation failed.'
    return res.status(502).json({ error: message })
  }
}
