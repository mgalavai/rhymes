import { useMemo, useState } from 'react'
import './App.css'

const DEFAULT_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? ''
const DEFAULT_MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-3.1-pro-preview'
const MODEL_FALLBACK_ORDER = ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']

const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Hindi',
  'Turkish',
  'Polish',
]

type WordIllustration = {
  word: string
  svg: string
}

type RhymePair = {
  rhymeSound: string
  left: WordIllustration
  right: WordIllustration
}

type WorksheetData = {
  title: string
  instruction: string
  language: string
  pairs: RhymePair[]
}

type ColumnCard = {
  id: string
  pairIndex: number
  word: string
  svg: string
  side: 'left' | 'right'
}

type GenerateParams = {
  apiKey: string
  model: string
  language: string
  pairCount: number
  topic: string
}

function normalizeModelName(rawModelName: string): string {
  const trimmed = rawModelName.trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

function withUniqueValues(items: string[]): string[] {
  return Array.from(new Set(items))
}

const FALLBACK_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="12" width="76" height="76" rx="14" fill="none" stroke="#111" stroke-width="4"/>
  <circle cx="38" cy="45" r="6" fill="none" stroke="#111" stroke-width="4"/>
  <circle cx="62" cy="45" r="6" fill="none" stroke="#111" stroke-width="4"/>
  <path d="M30 66 Q50 80 70 66" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/>
</svg>
`.trim()

const SVG_TAG_ALLOWLIST = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'clipPath',
  'mask',
  'title',
  'desc',
])

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[otherIndex]] = [copy[otherIndex], copy[index]]
  }

  return copy
}

function cleanWord(rawWord: unknown): string {
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

function sanitizeSvg(rawSvg: unknown): string {
  if (typeof rawSvg !== 'string' || !rawSvg.includes('<svg')) {
    return FALLBACK_SVG
  }

  const parser = new DOMParser()
  const documentNode = parser.parseFromString(rawSvg, 'image/svg+xml')

  if (documentNode.querySelector('parsererror')) {
    return FALLBACK_SVG
  }

  const root = documentNode.documentElement
  if (root.tagName.toLowerCase() !== 'svg') {
    return FALLBACK_SVG
  }

  const nodesToRemove: Element[] = []
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)

  while (treeWalker.nextNode()) {
    const element = treeWalker.currentNode as Element
    const tagName = element.tagName.toLowerCase()

    if (!SVG_TAG_ALLOWLIST.has(tagName)) {
      nodesToRemove.push(element)
      continue
    }

    const attributes = Array.from(element.attributes)
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value

      if (name.startsWith('on') || name === 'href' || name === 'xlink:href') {
        element.removeAttribute(attribute.name)
        continue
      }

      if (/url\(/i.test(value) && !value.includes('#')) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  nodesToRemove.forEach((node) => node.remove())

  root.removeAttribute('width')
  root.removeAttribute('height')
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  if (!root.getAttribute('viewBox')) {
    root.setAttribute('viewBox', '0 0 100 100')
  }

  return new XMLSerializer().serializeToString(root)
}

function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  throw new Error('Could not parse JSON from the model response.')
}

function normalizeWorksheet(candidate: unknown, language: string, pairCount: number): WorksheetData {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Model returned an unexpected worksheet format.')
  }

  const raw = candidate as Record<string, unknown>
  const rawPairs = Array.isArray(raw.pairs) ? raw.pairs : []

  if (rawPairs.length < pairCount) {
    throw new Error(`Model returned only ${rawPairs.length} pairs. Try regenerate.`)
  }

  const pairs: RhymePair[] = rawPairs.slice(0, pairCount).map((entry, index) => {
    const pair = entry as Record<string, unknown>
    const left = (pair.left ?? {}) as Record<string, unknown>
    const right = (pair.right ?? {}) as Record<string, unknown>

    return {
      rhymeSound:
        typeof pair.rhymeSound === 'string' && pair.rhymeSound.trim()
          ? pair.rhymeSound.trim()
          : `pair ${index + 1}`,
      left: {
        word: cleanWord(left.word),
        svg: sanitizeSvg(left.svg),
      },
      right: {
        word: cleanWord(right.word),
        svg: sanitizeSvg(right.svg),
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

function buildPrompt(language: string, pairCount: number, topic: string): string {
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

async function generateWorksheetWithGemini({
  apiKey,
  model,
  language,
  pairCount,
  topic,
}: GenerateParams): Promise<WorksheetData> {
  if (!apiKey.trim()) {
    throw new Error('API key is required.')
  }

  const normalizedModel = normalizeModelName(model)
  if (!normalizedModel) {
    throw new Error('Model name is required.')
  }

  const candidateModels = withUniqueValues([
    normalizedModel,
    ...MODEL_FALLBACK_ORDER.filter((modelName) => modelName !== normalizedModel),
  ])

  let lastErrorMessage = ''

  for (const modelName of candidateModels) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
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

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: { message?: string }
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>
            }
          }>
        }
      | null

    if (!response.ok) {
      const errorMessage = payload?.error?.message ?? `Gemini API request failed (${response.status}).`
      lastErrorMessage = errorMessage

      const canRetryModel = /not found|not supported|unsupported/i.test(errorMessage)
      if (!canRetryModel) {
        throw new Error(errorMessage)
      }

      continue
    }

    const modelText = payload?.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!modelText) {
      throw new Error('Gemini did not return worksheet content.')
    }

    const worksheetJson = JSON.parse(extractJsonText(modelText)) as unknown
    return normalizeWorksheet(worksheetJson, language, pairCount)
  }

  throw new Error(
    `Unable to generate with the provided model. Tried: ${candidateModels.join(', ')}. Last API error: ${lastErrorMessage || 'unknown error'}.`,
  )
}

function toColumnCards(worksheet: WorksheetData): { left: ColumnCard[]; right: ColumnCard[] } {
  const left = worksheet.pairs.map((pair, pairIndex) => ({
    id: `L-${pairIndex}-${pair.left.word}`,
    pairIndex,
    word: pair.left.word,
    svg: pair.left.svg,
    side: 'left' as const,
  }))

  const right = worksheet.pairs.map((pair, pairIndex) => ({
    id: `R-${pairIndex}-${pair.right.word}`,
    pairIndex,
    word: pair.right.word,
    svg: pair.right.svg,
    side: 'right' as const,
  }))

  return {
    left,
    right: shuffle(right),
  }
}

function App() {
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [language, setLanguage] = useState('English')
  const [pairCount, setPairCount] = useState(5)
  const [topic, setTopic] = useState('animals and everyday objects')
  const [worksheet, setWorksheet] = useState<WorksheetData | null>(null)
  const [cards, setCards] = useState<{ left: ColumnCard[]; right: ColumnCard[] } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)

  const handleGenerate = async () => {
    setIsLoading(true)
    setError('')

    try {
      const generated = await generateWorksheetWithGemini({
        apiKey,
        model,
        language,
        pairCount,
        topic,
      })

      setWorksheet(generated)
      setCards(toColumnCards(generated))
      setShowAnswers(false)
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Generation failed.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegenerate = async () => {
    await handleGenerate()
  }

  const handleShuffleRightColumn = () => {
    if (!cards) {
      return
    }

    setCards({
      left: cards.left,
      right: shuffle(cards.right),
    })
  }

  const answerPairs = useMemo(
    () =>
      worksheet?.pairs.map((pair, pairIndex) => ({
        pairIndex,
        leftWord: pair.left.word,
        rightWord: pair.right.word,
      })) ?? [],
    [worksheet],
  )

  return (
    <div className="app-shell">
      <header className="hero no-print">
        <h1>Rhyming Sheet Builder</h1>
        <p>
          Generate one printable worksheet with {pairCount * 2} illustrated cards. Kids draw lines
          between rhyming words.
        </p>
      </header>

      <section className="control-panel no-print">
        <label>
          API Key
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Gemini API key"
          />
        </label>

        <label>
          Model
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gemini-3.1-pro-preview"
          />
        </label>

        <label>
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          Cards
          <select
            value={pairCount}
            onChange={(event) => setPairCount(Number(event.target.value) as 4 | 5)}
          >
            <option value={4}>8 cards</option>
            <option value={5}>10 cards</option>
          </select>
        </label>

        <label className="topic-field">
          Topic
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="animals, fruits, home objects"
          />
        </label>

        <div className="button-row">
          <button type="button" onClick={handleGenerate} disabled={isLoading}>
            {isLoading ? 'Generating…' : worksheet ? 'Generate New Page' : 'Generate Page'}
          </button>
          <button type="button" onClick={handleRegenerate} disabled={isLoading || !worksheet}>
            Regenerate
          </button>
          <button type="button" onClick={handleShuffleRightColumn} disabled={!cards || isLoading}>
            Shuffle Right Column
          </button>
          <button type="button" onClick={() => window.print()} disabled={!worksheet}>
            Save as PDF
          </button>
          <button type="button" onClick={() => setShowAnswers((value) => !value)} disabled={!worksheet}>
            {showAnswers ? 'Hide Answers' : 'Show Answers'}
          </button>
        </div>

        {error ? <p className="error-box">{error}</p> : null}
        <p className="help-text">
          This demo keeps the API key in the browser only. You can enter either
          <code>gemini-3.1-pro-preview</code> or <code>models/gemini-3.1-pro-preview</code>.
        </p>
      </section>

      <section className="sheet-frame" aria-live="polite">
        {worksheet && cards ? (
          <article className="worksheet-page">
            <div className="worksheet-header">
              <h2>{worksheet.title}</h2>
              <p>{worksheet.instruction}</p>
              <span>
                Language: {worksheet.language} · Cards: {worksheet.pairs.length * 2}
              </span>
            </div>

            <div className="worksheet-columns">
              <ol className="cards-column" aria-label="Column A">
                {cards.left.map((card, index) => (
                  <li key={card.id} className="word-card left-card">
                    <span className="card-index">A{index + 1}</span>
                    <div className="svg-box" dangerouslySetInnerHTML={{ __html: card.svg }} />
                    <strong>{card.word}</strong>
                    <span className="connector-dot" aria-hidden="true" />
                  </li>
                ))}
              </ol>

              <ol className="cards-column" aria-label="Column B">
                {cards.right.map((card, index) => (
                  <li key={card.id} className="word-card right-card">
                    <span className="connector-dot" aria-hidden="true" />
                    <span className="card-index">B{index + 1}</span>
                    <div className="svg-box" dangerouslySetInnerHTML={{ __html: card.svg }} />
                    <strong>{card.word}</strong>
                  </li>
                ))}
              </ol>
            </div>

            <footer className="worksheet-footer">Draw a line from Column A to Column B to match rhymes.</footer>
          </article>
        ) : (
          <div className="empty-sheet">
            <h2>No worksheet yet</h2>
            <p>Pick language + topic, then click Generate Page.</p>
          </div>
        )}
      </section>

      {showAnswers && answerPairs.length > 0 ? (
        <section className="answer-key no-print">
          <h3>Answer Key</h3>
          <ul>
            {answerPairs.map((answer) => (
              <li key={`${answer.pairIndex}-${answer.leftWord}`}>
                {answer.leftWord} ↔ {answer.rightWord}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default App
