import { type CSSProperties, useRef, useState } from 'react'
import './App.css'

const DEFAULT_MODEL = 'gpt-4.1-mini'

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

const CARD_OPTIONS = [
  { pairs: 3, label: '6 cards' },
  { pairs: 4, label: '8 cards' },
  { pairs: 5, label: '10 cards' },
] as const

type PairCountOption = (typeof CARD_OPTIONS)[number]['pairs']

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

type GenerateWorksheetPayload = {
  error?: string
  worksheet?: unknown
  imageWarning?: string
  imageDiagnostics?: unknown
  deferredImages?: unknown
}

type RandomTopicPayload = {
  error?: string
  topic?: unknown
  source?: unknown
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

type SingleWordImagePayload = {
  error?: string
  imageDataUrl?: unknown
  imageDiagnostics?: unknown
}

function formatImageDiagnostics(value: unknown): string {
  if (!value) {
    return ''
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function RefreshIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide lucide-refresh-ccw-icon lucide-refresh-ccw"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  )
}

function DiceIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide lucide-dice-5-icon lucide-dice-5"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M16 8h.01" />
      <path d="M12 12h.01" />
      <path d="M8 16h.01" />
      <path d="M8 8h.01" />
      <path d="M16 16h.01" />
    </svg>
  )
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isRetryableHydrationError(message: string): boolean {
  return /rate limit|throttl|quota exceeded|retry in|429|resource exhausted/i.test(message)
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

async function generateWorksheet({
  model,
  language,
  pairCount,
  topic,
}: GenerateParams): Promise<{
  worksheet: WorksheetData
  imageWarning: string
  imageDiagnostics: string
  deferredImages: boolean
}> {
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
      deferImages: true,
    }),
  })

  const payload = (await response.json().catch(() => null)) as GenerateWorksheetPayload | null

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('API route is missing. Run with `vercel dev` locally or deploy to Vercel.')
    }

    throw new Error(payload?.error ?? `Worksheet generation failed (${response.status}).`)
  }

  return {
    worksheet: normalizeWorksheet(payload?.worksheet, language, pairCount),
    imageWarning:
      typeof payload?.imageWarning === 'string' ? payload.imageWarning.trim() : '',
    imageDiagnostics: formatImageDiagnostics(payload?.imageDiagnostics),
    deferredImages: payload?.deferredImages === true,
  }
}

async function requestSingleWordImage({
  word,
  language,
  topic,
}: {
  word: string
  language: string
  topic: string
}): Promise<string> {
  const response = await fetch('/api/generate-worksheet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      word,
      language,
      topic,
      replaceWord: false,
    }),
  })

  const payload = (await response.json().catch(() => null)) as SingleWordImagePayload | null
  if (!response.ok) {
    const baseError = payload?.error ?? `Image generation failed (${response.status}).`
    const details = formatImageDiagnostics(payload?.imageDiagnostics)
    throw new Error(details ? `${baseError}\n${details}` : baseError)
  }

  return sanitizeImageDataUrl(payload?.imageDataUrl)
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
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

async function randomizeTopicWithModel({
  language,
  topic,
}: {
  language: string
  topic: string
}): Promise<string> {
  const response = await fetch('/api/generate-worksheet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      randomizeTopic: true,
      language,
      topic,
    }),
  })

  const payload = (await response.json().catch(() => null)) as RandomTopicPayload | null

  if (!response.ok) {
    throw new Error(payload?.error ?? `Topic randomization failed (${response.status}).`)
  }

  const nextTopic = typeof payload?.topic === 'string' ? payload.topic.trim() : ''
  if (!nextTopic) {
    throw new Error('Model returned an empty topic.')
  }

  return nextTopic
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
  const [pairCount, setPairCount] = useState<PairCountOption>(5)
  const [topic, setTopic] = useState('animals and everyday objects')
  const [worksheet, setWorksheet] = useState<WorksheetData | null>(null)
  const [cards, setCards] = useState<{ left: ColumnCard[]; right: ColumnCard[] } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isHydratingImages, setIsHydratingImages] = useState(false)
  const [isRandomizingTopic, setIsRandomizingTopic] = useState(false)
  const [refreshingCardId, setRefreshingCardId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [warningDetails, setWarningDetails] = useState('')
  const generationRunRef = useRef(0)

  const patchWordImageEverywhere = (targetWord: string, imageDataUrl: string) => {
    setCards((previous) => {
      if (!previous) {
        return previous
      }

      const patchItems = (items: ColumnCard[]) =>
        items.map((item) =>
          item.word === targetWord
            ? {
                ...item,
                imageDataUrl,
              }
            : item,
        )

      return {
        left: patchItems(previous.left),
        right: patchItems(previous.right),
      }
    })

    setWorksheet((previous) => {
      if (!previous) {
        return previous
      }

      return {
        ...previous,
        pairs: previous.pairs.map((pair) => ({
          ...pair,
          left:
            pair.left.word === targetWord
              ? {
                  ...pair.left,
                  imageDataUrl,
                }
              : pair.left,
          right:
            pair.right.word === targetWord
              ? {
                  ...pair.right,
                  imageDataUrl,
                }
              : pair.right,
        })),
      }
    })
  }

  const hydrateImagesForWorksheet = async (sourceWorksheet: WorksheetData, runToken: number) => {
    const uniqueWords = Array.from(
      new Set(sourceWorksheet.pairs.flatMap((pair) => [pair.left.word, pair.right.word]).map(cleanWord)),
    )
    if (uniqueWords.length === 0) {
      return
    }

    setIsHydratingImages(true)
    setWarning(`Generating images (0/${uniqueWords.length})…`)
    setWarningDetails('')
    let completed = 0
    const failedWords: string[] = []
    const failedReasons: Record<string, string> = {}
    const perWordStartedAt = new Map<string, number>()
    const concurrency = 3

    await mapWithConcurrency(uniqueWords, concurrency, async (word) => {
      perWordStartedAt.set(word, performance.now())
      console.info('[rhymes-ui] hydrate:image-start', { word })

      try {
        let imageDataUrl = ''
        let lastError = ''

        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            imageDataUrl = await requestSingleWordImage({
              word,
              language,
              topic,
            })
            break
          } catch (caughtError) {
            lastError = caughtError instanceof Error ? caughtError.message : String(caughtError)
            if (!isRetryableHydrationError(lastError) || attempt >= 2) {
              throw caughtError
            }
            await sleep(300 * (attempt + 1))
          }
        }

        if (runToken !== generationRunRef.current) {
          return
        }

        if (imageDataUrl) {
          patchWordImageEverywhere(word, imageDataUrl)
        } else {
          failedWords.push(word)
          failedReasons[word] = lastError || 'no image data returned'
        }
      } catch (caughtError) {
        failedWords.push(word)
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        failedReasons[word] = message.slice(0, 420)
        console.error('[rhymes-ui] hydrate:image-error', {
          word,
          error: message,
        })
      } finally {
        completed += 1
        const startedAt = perWordStartedAt.get(word) ?? performance.now()
        console.info('[rhymes-ui] hydrate:image-done', {
          word,
          durationMs: Math.round(performance.now() - startedAt),
          completed,
          total: uniqueWords.length,
        })
        if (runToken === generationRunRef.current) {
          setWarning(`Generating images (${completed}/${uniqueWords.length})…`)
        }
      }
    })

    if (runToken !== generationRunRef.current) {
      return
    }

    if (failedWords.length > 0) {
      setWarning(
        `Some images could not be generated (${failedWords.length}/${uniqueWords.length}). You can refresh individual cards.`,
      )
      setWarningDetails(JSON.stringify({ failedWords, failedReasons }, null, 2))
    } else {
      setWarning('')
      setWarningDetails('')
    }

    setIsHydratingImages(false)
  }

  const handleGenerate = async () => {
    generationRunRef.current += 1
    const runToken = generationRunRef.current
    const startedAt = performance.now()
    console.info('[rhymes-ui] generate:start', { language, pairCount, topic, model: DEFAULT_MODEL })
    setIsLoading(true)
    setIsHydratingImages(false)
    setError('')
    setWarning('')
    setWarningDetails('')

    try {
      const generated = await generateWorksheet({
        model: DEFAULT_MODEL,
        language,
        pairCount,
        topic,
      })

      setWorksheet(generated.worksheet)
      setCards(toColumnCards(generated.worksheet))
      setWarning(generated.imageWarning)
      setWarningDetails(generated.imageDiagnostics)
      if (generated.deferredImages) {
        void hydrateImagesForWorksheet(generated.worksheet, runToken)
      }
      console.info('[rhymes-ui] generate:done', {
        durationMs: Math.round(performance.now() - startedAt),
        pairCount,
        warning: generated.imageWarning || '(none)',
        deferredImages: generated.deferredImages,
      })
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Generation failed.'
      setError(message)
      setIsHydratingImages(false)
      console.error('[rhymes-ui] generate:error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: message,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegenerate = async () => {
    await handleGenerate()
  }

  const handleRefreshCardImage = async (card: ColumnCard) => {
    if (isLoading || refreshingCardId || !cards) {
      return
    }

    const pairedCard =
      card.side === 'left'
        ? cards.right.find((item) => item.pairIndex === card.pairIndex)
        : cards.left.find((item) => item.pairIndex === card.pairIndex)

    const pairedWord = pairedCard ? pairedCard.word : ''
    setRefreshingCardId(card.id)
    setError('')
    const startedAt = performance.now()
    console.info('[rhymes-ui] refresh:start', { word: card.word, side: card.side, pairedWord })

    try {
      let didChangeCard = false

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch('/api/generate-worksheet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            word: card.word,
            pairedWord,
            replaceWord: true,
            language,
            topic,
            variationHint: `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}`,
          }),
        })

        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string
              imageDataUrl?: unknown
              word?: unknown
              imageDiagnostics?: unknown
            }
          | null

        if (!response.ok) {
          const details = formatImageDiagnostics(payload?.imageDiagnostics)
          const baseError = payload?.error ?? `Could not refresh "${card.word}" card.`
          throw new Error(details ? `${baseError}\n\n${details}` : baseError)
        }

        const nextImageDataUrl = sanitizeImageDataUrl(payload?.imageDataUrl)
        const nextWord = cleanWord(payload?.word ?? card.word)

        if (!nextImageDataUrl) {
          throw new Error(`Received invalid image data for "${card.word}".`)
        }

        if (nextImageDataUrl !== card.imageDataUrl || nextWord !== card.word) {
          setCards((previous) => {
            if (!previous) {
              return previous
            }

            const patchItems = (items: ColumnCard[]) =>
              items.map((item) =>
                item.id === card.id
                  ? {
                      ...item,
                      word: nextWord,
                      imageDataUrl: nextImageDataUrl,
                    }
                  : item,
              )

            return {
              left: patchItems(previous.left),
              right: patchItems(previous.right),
            }
          })

          setWorksheet((previous) => {
            if (!previous) {
              return previous
            }

            return {
              ...previous,
              pairs: previous.pairs.map((pair, pairIndex) => {
                if (pairIndex !== card.pairIndex) {
                  return pair
                }

                if (card.side === 'left') {
                  return {
                    ...pair,
                    left: {
                      ...pair.left,
                      word: nextWord,
                      imageDataUrl: nextImageDataUrl,
                    },
                  }
                }

                return {
                  ...pair,
                  right: {
                    ...pair.right,
                    word: nextWord,
                    imageDataUrl: nextImageDataUrl,
                  },
                }
              }),
            }
          })

          didChangeCard = true
          console.info('[rhymes-ui] refresh:done', {
            oldWord: card.word,
            newWord: nextWord,
            durationMs: Math.round(performance.now() - startedAt),
          })
          break
        }
      }

      if (!didChangeCard) {
        throw new Error(`No alternative returned for "${card.word}" yet. Try refresh again.`)
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : `Could not refresh "${card.word}" right now.`
      setError(message)
      console.error('[rhymes-ui] refresh:error', {
        word: card.word,
        durationMs: Math.round(performance.now() - startedAt),
        error: message,
      })
    } finally {
      setRefreshingCardId(null)
    }
  }

  const handleRandomizeTopic = async () => {
    if (isLoading || isRandomizingTopic) {
      return
    }

    const startedAt = performance.now()
    console.info('[rhymes-ui] topic-randomize:start', { language, currentTopic: topic })
    setIsRandomizingTopic(true)
    setError('')

    try {
      const nextTopic = await randomizeTopicWithModel({
        language,
        topic,
      })
      setTopic(nextTopic)
      console.info('[rhymes-ui] topic-randomize:done', {
        durationMs: Math.round(performance.now() - startedAt),
        topic: nextTopic,
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Could not randomize topic right now.'
      setError(message)
      console.error('[rhymes-ui] topic-randomize:error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: message,
      })
    } finally {
      setIsRandomizingTopic(false)
    }
  }

  return (
    <div className="app-shell">
      <main className="workspace">
        <section className="sheet-frame" aria-live="polite">
          {worksheet && cards ? (
            <article
              className="worksheet-page"
              style={{ '--pair-count': String(cards.left.length) } as CSSProperties}
            >
              <div className="worksheet-header">
                <h2>{worksheet.title}</h2>
                <p>{worksheet.instruction}</p>
              </div>

              <div className="worksheet-columns">
                <ol className="items-column" aria-label="Column A">
                  {cards.left.map((card) => (
                    <li key={card.id} className="sheet-item">
                      <div className="item-illustration">
                        <div className="svg-box">
                          <button
                            type="button"
                            className={`refresh-image-btn ${refreshingCardId === card.id ? 'is-loading' : ''}`}
                            onClick={() => void handleRefreshCardImage(card)}
                            disabled={isLoading || refreshingCardId !== null}
                            aria-label={`Replace card for ${card.word}`}
                            title={`Replace card for ${card.word}`}
                          >
                            <RefreshIcon />
                          </button>
                          {card.imageDataUrl ? (
                            <img src={card.imageDataUrl} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <div className="image-missing" role="img" aria-label="Image unavailable">
                              image unavailable
                            </div>
                          )}
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
                          <button
                            type="button"
                            className={`refresh-image-btn ${refreshingCardId === card.id ? 'is-loading' : ''}`}
                            onClick={() => void handleRefreshCardImage(card)}
                            disabled={isLoading || refreshingCardId !== null}
                            aria-label={`Replace card for ${card.word}`}
                            title={`Replace card for ${card.word}`}
                          >
                            <RefreshIcon />
                          </button>
                          {card.imageDataUrl ? (
                            <img src={card.imageDataUrl} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <div className="image-missing" role="img" aria-label="Image unavailable">
                              image unavailable
                            </div>
                          )}
                        </div>
                      </div>
                      <strong>{card.word}</strong>
                    </li>
                  ))}
                </ol>
              </div>

              <footer className="worksheet-footer">
                Draw lines to match rhymes.
              </footer>
            </article>
          ) : (
            <div className="empty-sheet">
              <h2>No worksheet yet</h2>
              <p>Pick language + topic, then click Generate Page.</p>
            </div>
          )}
        </section>
      </main>

      <aside className="control-panel no-print">
        <header className="panel-hero">
          <h1>Rhyming Sheet Builder</h1>
          <p>
            Generate one printable worksheet with {pairCount * 2} illustrated cards. Kids draw
            lines between rhyming words.
          </p>
        </header>

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
          <div className="cards-tabs" role="tablist" aria-label="Cards per worksheet">
            {CARD_OPTIONS.map((option) => {
              const isActive = pairCount === option.pairs
              return (
                <button
                  key={option.pairs}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`cards-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setPairCount(option.pairs)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </label>

        <label className="topic-field">
          Topic
          <div className="topic-input-wrap">
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="animals, fruits, home objects"
            />
            <button
              type="button"
              className={`topic-randomize-btn ${isRandomizingTopic ? 'is-loading' : ''}`}
              onClick={() => void handleRandomizeTopic()}
              disabled={isLoading || isRandomizingTopic}
              aria-label="Randomize topic with AI"
              title="Randomize topic with AI"
            >
              <DiceIcon />
            </button>
          </div>
        </label>

        <div className="button-row">
          <button type="button" onClick={handleGenerate} disabled={isLoading}>
            {isLoading
              ? 'Generating words…'
              : isHydratingImages
                ? 'Generating images…'
                : worksheet
                  ? 'Generate New Page'
                  : 'Generate Page'}
          </button>
          <button type="button" onClick={handleRegenerate} disabled={isLoading || !worksheet}>
            Regenerate
          </button>
          <button type="button" onClick={() => window.print()} disabled={!worksheet}>
            Save as PDF
          </button>
        </div>

        {error ? <p className="error-box">{error}</p> : null}
        {!error && warning ? (
          <div className="warning-box">
            <p>{warning}</p>
            {warningDetails ? (
              <details className="warning-details">
                <summary>Technical details</summary>
                <pre>{warningDetails}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
        <p className="help-text">
          API key stays server-side (<code>OPENAI_API_KEY</code>). Text generation uses
          <code>{DEFAULT_MODEL}</code>; images use <code>gpt-image-1</code>.
        </p>
      </aside>
    </div>
  )
}

export default App
