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
  imageDataUrl: string
  mimeType?: string
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
  imageDataUrl: string
  side: 'left' | 'right'
}

type GenerateParams = {
  model: string
  language: string
  pairCount: number
  topic: string
}

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

function sanitizeImageDataUrl(rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    return ''
  }

  const value = rawValue.trim()
  if (!value) {
    return ''
  }

  if (/^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
    return value
  }

  if (/^https?:\/\/\S+$/i.test(value)) {
    return value
  }

  return ''
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
        imageDataUrl: sanitizeImageDataUrl(left.imageDataUrl),
        mimeType: typeof left.mimeType === 'string' ? left.mimeType : undefined,
      },
      right: {
        word: cleanWord(right.word),
        imageDataUrl: sanitizeImageDataUrl(right.imageDataUrl),
        mimeType: typeof right.mimeType === 'string' ? right.mimeType : undefined,
      },
    }
  })

  const missingImages = pairs.filter((pair) => !pair.left.imageDataUrl || !pair.right.imageDataUrl)
  if (missingImages.length > 0) {
    throw new Error(
      'Image generation did not return child-illustration images for all items. Regenerate and ensure image model access.',
    )
  }

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
    imageDataUrl: pair.left.imageDataUrl,
    side: 'left' as const,
  }))

  const right = worksheet.pairs.map((pair, pairIndex) => ({
    id: `R-${pairIndex}-${pair.right.word}`,
    pairIndex,
    word: pair.right.word,
    imageDataUrl: pair.right.imageDataUrl,
    side: 'right' as const,
  }))

  return {
    left,
    right: shuffle(right),
  }
}

function App() {
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
        model: DEFAULT_MODEL,
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
      <main className="workspace">
        <header className="hero no-print">
          <h1>Rhyming Sheet Builder</h1>
          <p>
            Generate one printable worksheet with {pairCount * 2} illustrated cards. Kids draw
            lines between rhyming words.
          </p>
        </header>

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
                <ol className="items-column" aria-label="Column A">
                  {cards.left.map((card) => (
                    <li key={card.id} className="sheet-item">
                      <div className="item-illustration">
                        <div className="svg-box">
                          <img src={card.imageDataUrl} alt="" loading="lazy" decoding="async" />
                        </div>
                      </div>
                      <strong>{card.word}</strong>
                    </li>
                  ))}
                </ol>

                <ol className="items-column" aria-label="Column B">
                  {cards.right.map((card) => (
                    <li key={card.id} className="sheet-item">
                      <div className="item-illustration">
                        <div className="svg-box">
                          <img src={card.imageDataUrl} alt="" loading="lazy" decoding="async" />
                        </div>
                      </div>
                      <strong>{card.word}</strong>
                    </li>
                  ))}
                </ol>
              </div>

              <footer className="worksheet-footer">
                Draw lines from Column A to Column B to match rhymes.
              </footer>
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
      </main>

      <aside className="control-panel no-print">
        <h2 className="panel-title">Worksheet Controls</h2>

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
          API key is server-side only (<code>GEMINI_API_KEY</code>). Text generation uses
          <code>{DEFAULT_MODEL}</code>; icons use <code>GEMINI_IMAGE_MODEL</code> (default:
          <code>gemini-2.5-flash-image</code>). If image entitlement is blocked, PNG emoji fallback
          is used.
        </p>
      </aside>
    </div>
  )
}

export default App
