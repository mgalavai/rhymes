const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
const MODEL_FALLBACK_ORDER = ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']

function normalizeModelName(rawModelName) {
  const trimmed = String(rawModelName || '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

function unique(items) {
  return Array.from(new Set(items))
}

function buildPrompt(language, pairCount, topic) {
  return [
    'You create printable phonics worksheets for children aged 6 to 8.',
    `Generate exactly ${pairCount} rhyming pairs (${pairCount * 2} total picture cards).`,
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
    '      "left": {"word": "noun", "svg": "<svg ...>...</svg>"},',
    '      "right": {"word": "noun", "svg": "<svg ...>...</svg>"}',
    '    }',
    '  ]',
    '}',
    '',
    'Requirements:',
    '- Words must be concrete, child-friendly nouns and should rhyme clearly in the target language.',
    '- Keep words short when possible and avoid offensive or abstract vocabulary.',
    '- Each SVG must be a simple black-and-white line drawing, no text labels, no background, printable.',
    '- Each SVG should use viewBox="0 0 100 100" and contain one object/animal only.',
    '- Do not include markdown fences or explanations, output JSON only.',
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

function normalizeWorksheet(candidate, language, pairCount) {
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
    const left = pair.left || {}
    const right = pair.right || {}

    return {
      rhymeSound:
        typeof pair.rhymeSound === 'string' && pair.rhymeSound.trim()
          ? pair.rhymeSound.trim()
          : `pair ${index + 1}`,
      left: {
        word: cleanWord(left.word),
        svg: typeof left.svg === 'string' ? left.svg : '',
      },
      right: {
        word: cleanWord(right.word),
        svg: typeof right.svg === 'string' ? right.svg : '',
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
    return `The API project for this key has model entitlement set to 0 ("limit: 0"). This is usually a project/billing-tier configuration issue, not normal daily usage. Try model gemini-2.5-flash or enable paid access on the same Google project as this key. Tried models: ${triedModels.join(', ')}.`
  }

  if (/quota exceeded|rate limit|resource exhausted/.test(lowerMessage)) {
    const retrySeconds = parseRetrySeconds(errorMessage)
    return retrySeconds
      ? `Gemini throttled this request. Retry in about ${retrySeconds}s. Tried models: ${triedModels.join(', ')}.`
      : `Gemini throttled this request. Tried models: ${triedModels.join(', ')}.`
  }

  return `${errorMessage || 'Unknown Gemini API error.'} Tried models: ${triedModels.join(', ')}.`
}

async function callGeminiModel({ apiKey, model, language, pairCount, topic }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: buildPrompt(language, pairCount, topic),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.75,
        },
      }),
    },
  )

  const payload = await response.json().catch(() => null)

  return { response, payload }
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

  const requestedModel = normalizeModelName(typeof body.model === 'string' ? body.model : '')
  const defaultModel = normalizeModelName(DEFAULT_MODEL) || 'gemini-2.5-flash'
  const candidateModels = unique([
    requestedModel || defaultModel,
    ...MODEL_FALLBACK_ORDER.filter((modelName) => modelName !== requestedModel),
  ])

  let lastErrorMessage = ''
  let lastStatus = 500

  for (const modelName of candidateModels) {
    const { response, payload } = await callGeminiModel({
      apiKey,
      model: modelName,
      language,
      pairCount,
      topic,
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

      return res.status(response.status).json({
        error: humanizeGeminiError(errorMessage, [modelName]),
      })
    }

    const modelText = (payload && payload.candidates ? payload.candidates : [])
      .flatMap((candidate) => (candidate && candidate.content && candidate.content.parts ? candidate.content.parts : []))
      .map((part) => (part && part.text ? part.text : ''))
      .join('')
      .trim()

    if (!modelText) {
      lastErrorMessage = 'Gemini did not return worksheet content.'
      lastStatus = 502
      continue
    }

    try {
      const worksheetJson = JSON.parse(extractJsonText(modelText))
      const worksheet = normalizeWorksheet(worksheetJson, language, pairCount)

      return res.status(200).json({
        worksheet,
        usedModel: modelName,
      })
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : 'Invalid JSON returned from model.'
      lastStatus = 502
    }
  }

  return res.status(lastStatus).json({
    error: humanizeGeminiError(lastErrorMessage, candidateModels),
  })
}
