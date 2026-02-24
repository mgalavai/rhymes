const DEFAULT_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'

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

function buildImagePrompt(word, language, topic, variationHint = '') {
  return [
    `Create one polished children's clipart icon for the word "${word}" in ${language}.`,
    `Worksheet topic context: ${topic || 'animals and everyday objects'}.`,
    variationHint
      ? `Create a noticeably different variation than previous versions. Variation hint: ${variationHint}.`
      : 'Create a distinct icon composition and silhouette.',
    'Output requirements:',
    '- Isolated single object only, transparent background.',
    '- No scene, no frame, no text, no watermark.',
    '- Child-friendly educational icon style, clean edges, centered object.',
    '- Keep full object visible with margin from image edges.',
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

async function generateWordImage({ apiKey, word, language, topic, candidateModels, variationHint = '' }) {
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
                  text: buildImagePrompt(word, language, topic, variationHint),
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
  const parsedPairCount = Number(body.pairCount)
  const pairCount = [3, 4, 5].includes(parsedPairCount) ? parsedPairCount : 5
  const singleWordRequest = typeof body.word === 'string' ? cleanWord(body.word) : ''
  const pairedWordRequest = typeof body.pairedWord === 'string' ? cleanWord(body.pairedWord) : ''
  const replaceWord = body.replaceWord === true
  const variationHint = typeof body.variationHint === 'string' ? body.variationHint.trim() : ''

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
    let targetWord = singleWordRequest

    if (replaceWord && pairedWordRequest) {
      targetWord = await generateAlternativeWord({
        apiKey,
        currentWord: singleWordRequest,
        pairedWord: pairedWordRequest,
        language,
        topic,
        candidateModels: textModelCandidates,
      })
    }

    const image = await generateWordImage({
      apiKey,
      word: targetWord,
      language,
      topic,
      candidateModels: imageModelCandidates,
      variationHint,
    })

    if (image && image.imageDataUrl) {
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
        rawImageModelEnv,
        normalizedImageModel: requestedImageModel,
        imageModelCandidates,
        sampleAttempts:
          image && Array.isArray(image.debugAttempts) ? image.debugAttempts.slice(-3) : [],
      },
    })
  }

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
    const missingReasons = summarizeMissingImageReasons(imageResults)
    const failureDiagnostics = collectImageFailureDiagnostics(imageResults)

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
      imageWarning:
        missingWords.length > 0
          ? `Some images could not be generated (${missingWords.length}/${uniqueWords.length}). You can still print the worksheet and refresh individual cards later.${
              missingReasons.length > 0 ? ` Details: ${missingReasons.join(' || ')}` : ''
            }`
          : '',
      imageDiagnostics:
        missingWords.length > 0
          ? {
              rawImageModelEnv,
              normalizedImageModel: requestedImageModel,
              imageModelCandidates,
              missingWords,
              sampleFailures: failureDiagnostics,
            }
          : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Worksheet generation failed.'
    return res.status(502).json({ error: message })
  }
}
