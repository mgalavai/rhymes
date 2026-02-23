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
npm run dev
```

Open the app URL printed by Vite.

## Environment Variables

- `VITE_GEMINI_API_KEY`: your Gemini API key
- `VITE_GEMINI_MODEL`: optional, defaults to `gemini-3.1-pro`

For Vercel, add the same variables in Project Settings -> Environment Variables.

## How To Use

1. Add key/model in `.env` (or Vercel env settings).
2. Optionally replace API key in the UI for temporary testing.
3. Set model (default is `gemini-3.1-pro`).
4. Choose language, card count (8 or 10), and topic.
5. Click `Generate Page`.
6. Click `Save as PDF` to export.

## Notes

- This demo calls Gemini directly from the browser.
- `.env` files are ignored from git; use `.env.example` as template.
- If the configured model name is not available in your account, update the model field.
