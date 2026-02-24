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

- `OPENAI_API_KEY`: required. Used for worksheet text and image generation (server-side only).

For Vercel, add the same variables in Project Settings -> Environment Variables.

## How To Use

1. Add `OPENAI_API_KEY` in `.env` or Vercel env settings.
2. Model defaults are built in (`gpt-4.1-mini` for text, `gpt-image-1` for images).
3. Choose language, card count (6, 8, or 10), and topic.
4. Click `Generate Page`.
5. Click `Save as PDF` to export.

## Notes

- Requests go through `/api/generate-worksheet`, so API keys are never exposed to the browser.
- `.env` files are ignored from git; use `.env.example` as template.
- The API generates rhyme words with OpenAI text model, then generates icons with OpenAI image model.
- Worksheet generation returns words first, then images are fetched in parallel to avoid long blocking requests/timeouts.
- If image generation is partially unavailable, the worksheet is still returned and missing images are shown as placeholders.
