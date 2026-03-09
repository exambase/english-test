# AQA GCSE English Mock Marker Repo

This repo gives you a ready-to-upload starter project for a **GitHub Pages frontend** plus a **serverless Groq marking endpoint**.

## What is inside

- `index.html` – the dashboard page
- `app.js` – fetches the question bank, renders the paper-style view, saves answers locally, sends answers for marking, and supports copy-to-clipboard
- `styles.css` – dashboard and mock paper styling
- `data/` – the JSON question bank folder
- `api/mark.js` – Vercel-style serverless function that calls Groq safely on the server

## Important note about the question bank

The texts and questions are **original mock materials** written in the style of AQA GCSE English Language question formats. They are not copied from live or past AQA papers.

## JSON folder layout

- `data/question-bank.json` – all 30 questions in one file
- `data/4-mark.json`
- `data/8-mark.json`
- `data/12-mark.json`
- `data/16-mark.json`
- `data/20-mark.json`
- `data/40-mark.json`
- `data/index.json`

Each mark category contains **5 questions**, so the bank includes:

- 5 x 4-mark
- 5 x 8-mark
- 5 x 12-mark
- 5 x 16-mark
- 5 x 20-mark
- 5 x 40-mark

## How to use it

### Frontend on GitHub Pages

1. Upload these files to a GitHub repo.
2. Enable GitHub Pages for the repo.
3. Open the published site.

### Backend on Vercel

1. Import the same repo into Vercel.
2. In Vercel project settings, add environment variable:
   - `GROQ_API_KEY`
3. Optional:
   - `GROQ_MODEL=llama-3.1-8b-instant`
   - `ALLOW_ORIGIN=*`
4. Deploy.
5. Copy your deployed endpoint URL, for example:
   - `https://your-project.vercel.app/api/mark`

### Connect the dashboard to the marker

1. Open the dashboard.
2. Paste the endpoint URL into the **Groq proxy / serverless endpoint** field.
3. Click **Save endpoint**.
4. Pick a question, paste a student answer, then click **Mark response**.

## Copy to clipboard

After marking, click **Copy to clipboard** and the dashboard will copy:

- paper and question title
- score
- band
- subscores when available
- feedback
- marking breakdown

That text can then be pasted into Teams for a teacher.

## Notes

- The serverless function handles CORS for a static frontend.
- For the multiple-choice 4-mark true-statement questions, the function uses deterministic marking.
- For all other question types, the function sends the question, rubric and student answer to Groq and requests structured JSON back.

## Suggested next improvements

- Add login / saved classes
- Add full-paper mode
- Add export to PDF
- Add teacher-only rubric editing
