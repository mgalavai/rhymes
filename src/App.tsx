import { useMemo, useState } from 'react'
import './App.css'

const DEFAULT_MODEL = 'gemini-3.1-pro-preview'

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
  model: string
  language: string
  pairCount: number
  topic: string
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

type SvgViewBox = {
  x: number
  y: number
  width: number
  height: number
}

function parseViewBox(value: string | null): SvgViewBox {
  if (!value) {
    return { x: 0, y: 0, width: 100, height: 100 }
  }

  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map((entry) => Number(entry))

  if (parts.length !== 4 || parts.some((entry) => !Number.isFinite(entry))) {
    return { x: 0, y: 0, width: 100, height: 100 }
  }

  const [, , width, height] = parts
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 100, height: 100 }
  }

  return { x: parts[0], y: parts[1], width, height }
}

function getNumericAttribute(element: Element, attributeName: string, fallbackValue: number): number {
  const raw = element.getAttribute(attributeName)
  if (raw === null || raw.trim() === '') {
    return fallbackValue
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

function isLikelyBackgroundRect(element: Element, viewBox: SvgViewBox): boolean {
  if (element.tagName.toLowerCase() !== 'rect') {
    return false
  }

  const stroke = (element.getAttribute('stroke') || '').trim().toLowerCase()
  if (stroke && stroke !== 'none') {
    return false
  }

  const fill = (element.getAttribute('fill') || '').trim().toLowerCase()
  if (!fill || fill === 'none' || fill === 'transparent') {
    return false
  }

  const fillOpacity = getNumericAttribute(element, 'fill-opacity', 1)
  if (fillOpacity < 0.08) {
    return false
  }

  const rectX = getNumericAttribute(element, 'x', viewBox.x)
  const rectY = getNumericAttribute(element, 'y', viewBox.y)
  const rectWidth = getNumericAttribute(element, 'width', viewBox.width)
  const rectHeight = getNumericAttribute(element, 'height', viewBox.height)

  if (rectWidth <= 0 || rectHeight <= 0) {
    return false
  }

  const coversMostWidth = rectWidth >= viewBox.width * 0.95
  const coversMostHeight = rectHeight >= viewBox.height * 0.95
  const nearLeft = rectX <= viewBox.x + viewBox.width * 0.05
  const nearTop = rectY <= viewBox.y + viewBox.height * 0.05

  return coversMostWidth && coversMostHeight && nearLeft && nearTop
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

  const viewBox = parseViewBox(root.getAttribute('viewBox'))
  const backgroundRects = Array.from(root.querySelectorAll('rect')).filter((element) =>
    isLikelyBackgroundRect(element, viewBox),
  )
  backgroundRects.forEach((element) => element.remove())

  return new XMLSerializer().serializeToString(root)
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

async function generateWorksheetWithGemini({
  model,
  language,
  pairCount,
  topic,
}: GenerateParams): Promise<WorksheetData> {
  if (!model.trim()) {
    throw new Error('Model name is required.')
  }

  const response = await fetch('/api/generate-worksheet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      language,
      pairCount,
      topic,
    }),
  })

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string
        worksheet?: unknown
      }
    | null

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('API route is missing. Run with `vercel dev` locally or deploy to Vercel.')
    }

    throw new Error(payload?.error ?? `Worksheet generation failed (${response.status}).`)
  }

  return normalizeWorksheet(payload?.worksheet, language, pairCount)
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
          API key is server-side only (Vercel env <code>GEMINI_API_KEY</code>) and never sent to
          the browser.
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
