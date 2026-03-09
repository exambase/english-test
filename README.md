# AQA GCSE English Mock Paper Dashboard

This repo contains a **working static dashboard** plus a **serverless Groq marking endpoint**.

## What changed in this rebuilt version

- The student **does not pick a single question** anymore.
- The dashboard now **generates a full Paper 1 or Paper 2 mock paper automatically** from the bank.
- The question bank is still stored in `data/`, but the same bank is also embedded inside `index.html` as a fallback.
- That means the dashboard still loads even if the JSON request fails, so the old `Question bank request failed (404)` problem is covered by a fallback copy.

## Files

- `index.html` – the full dashboard page
- `app.js` – full paper generation, autosave, marking and copy-to-clipboard
- `styles.css` – paper-style layout
- `data/question-bank.json` – full bank
- `data/paper1-packs.json` – Paper 1 packs only
- `data/paper2-packs.json` – Paper 2 packs only
- `data/4-mark.json`, `data/8-mark.json`, `data/12-mark.json`, `data/16-mark.json`, `data/20-mark.json`, `data/40-mark.json`
- `api/mark.js` – Vercel serverless endpoint for Groq

## How the paper bank works now

The bank is organised as **complete paper packs** instead of isolated questions.

There are:

- 5 complete **Paper 1** packs
- 5 complete **Paper 2** packs

Each click of **Generate full paper** picks one pack for the selected paper type.

## Deploy steps

### 1. Upload this repo to GitHub
Create a new repo and upload every file and folder exactly as they are.

### 2. Turn on GitHub Pages
In GitHub:
- open the repo
- go to **Settings**
- go to **Pages**
- publish from your main branch

### 3. Deploy the backend on Vercel
Import the same repo into Vercel.

Add environment variables:
- `GROQ_API_KEY=your-real-groq-key`
- optional: `GROQ_MODEL=llama-3.1-8b-instant`
- optional: `ALLOW_ORIGIN=*`

Deploy.

### 4. Copy the backend URL into the dashboard
Open your live GitHub Pages site.

Paste your Vercel endpoint into the endpoint box, for example:
- `https://your-project.vercel.app/api/mark`

Click **Save endpoint**.

### 5. Use it
- Choose **Paper 1**, **Paper 2**, or **Random**
- Click **Generate full paper**
- Student answers every question
- Click **Mark this paper**
- Click **Copy to clipboard** to copy the full breakdown for Teams

## Important

- Do **not** put the Groq key in the frontend
- Do **not** delete the `data/` folder
- Do **not** rename `api/mark.js`

## Notes about local testing

If you just double-click `index.html`, some browsers can block JSON fetches from local files.
This rebuilt version includes an embedded fallback bank inside the HTML, so the page should still load,
but the real intended use is still a proper hosted site on GitHub Pages.