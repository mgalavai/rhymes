# Rhyming Worksheet Generator

A small React app that generates printable rhyming worksheets for children (6-8 years old) using OpenAI.

Each generated page has:
- 6, 8, or 10 illustrated vocabulary cards
- Two columns for rhyming-word matching
- Print-friendly layout for PDF export

## Features

- Multiple language support (choose language per worksheet)
- AI-generated rhyming pairs and isolated image icons
- Topic randomizer button (dice) powered by OpenAI text model
- Regenerate new page quickly
- Shuffle right column for new matching order
- Save as PDF via browser print dialog

## Quick Start

```bash
cp .env.example .env
npm install
npx vercel dev
```

Open the local URL printed by Vercel.

If you run `npm run dev`, only the Vite frontend starts (no `/api` serverless route).

## Environment Variables

- `OPENAI_API_KEY`: OpenAI API key for text and image generation (server-side only)
- `OPENAI_TEXT_MODEL`: optional OpenAI text model for rhymes (default: `gpt-4.1-mini`)
- `OPENAI_IMAGE_MODEL`: optional OpenAI image model (default: `gpt-image-1`)
- `OPENAI_IMAGE_SIZE`: valid OpenAI image size for `gpt-image-1` (`1024x1024`, `1024x1536`, `1536x1024`, or `auto`; default: `auto`)
- `OPENAI_TOPIC_MODEL`: optional OpenAI text model for random topic suggestions (default: `gpt-4.1-mini`)
- `IMAGE_PROVIDER`: `openai` or `gemini` (default: auto -> OpenAI if `OPENAI_API_KEY` exists, else Gemini)
- `GEMINI_API_KEY`: optional Gemini API key only when `IMAGE_PROVIDER=gemini`
- `GEMINI_IMAGE_MODEL`: optional Gemini image model when provider is Gemini (default: `gemini-2.5-flash-image`)
- `GEMINI_IMAGE_ATTEMPTS`: optional retries per word (default: `1`)
- `GEMINI_IMAGE_CONCURRENCY`: optional parallel image requests (default: `4`)
- `OPENAI_IMAGE_ATTEMPTS`: optional retries per image request when provider is OpenAI (default: `1`)
- `OPENAI_IMAGE_CONCURRENCY`: optional parallel OpenAI image requests (default: `8`)
- `VERBOSE_SHEET_LOGS`: set `1` for detailed API timing logs (default: `1`)

For Vercel, add the same variables in Project Settings -> Environment Variables.

## How To Use

1. Add `OPENAI_API_KEY`, plus optional vars (`OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `IMAGE_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`) in `.env` or Vercel env settings.
2. Optionally set text model via `OPENAI_TEXT_MODEL` (default is `gpt-4.1-mini`).
3. Choose language, card count (6, 8, or 10), and topic.
4. Click `Generate Page`.
5. Click `Save as PDF` to export.

## Notes

- Requests go through `/api/generate-worksheet`, so API keys are never exposed to the browser.
- `.env` files are ignored from git; use `.env.example` as template.
- The API generates rhyme words with OpenAI text model, then generates icons with OpenAI (default) or Gemini when configured.
- Worksheet generation returns words first, then images are fetched in parallel to avoid long blocking requests/timeouts.
- If image generation is partially unavailable, the worksheet is still returned and missing images are shown as placeholders.
- The API normalizes older image-model aliases (for example `gemini-2.5-flash-preview-image` -> `gemini-2.5-flash-image`).
- If a model is unavailable or entitlement-limited, the API retries with fallback image models.
