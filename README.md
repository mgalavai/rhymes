# Rhyming Worksheet Generator

A small React app that generates printable rhyming worksheets for children (6-8 years old) using Gemini.

Each generated page has:
- 8 or 10 illustrated vocabulary cards
- Two columns for rhyming-word matching
- Print-friendly layout for PDF export

## Features

- Multiple language support (choose language per worksheet)
- AI-generated rhyming pairs and SVG illustrations
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

- `GEMINI_API_KEY`: your Gemini API key (server-side only)
- `GEMINI_MODEL`: optional, defaults to `gemini-3.1-pro-preview`

For Vercel, add the same variables in Project Settings -> Environment Variables.

## How To Use

1. Add `GEMINI_API_KEY` and optional `GEMINI_MODEL` in `.env` or Vercel env settings.
2. Set model (default is `gemini-3.1-pro-preview`).
3. Choose language, card count (8 or 10), and topic.
4. Click `Generate Page`.
5. Click `Save as PDF` to export.

## Notes

- Gemini requests go through `/api/generate-worksheet`, so the API key is never exposed to the browser.
- `.env` files are ignored from git; use `.env.example` as template.
- Model field accepts both `gemini-...` and `models/gemini-...`.
- If a model is unavailable or entitlement-limited, the API retries with fallback models (`gemini-2.5-pro`, `gemini-2.5-flash`).
