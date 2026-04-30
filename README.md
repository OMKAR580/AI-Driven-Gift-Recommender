# GiftAI Atelier - AI Driven Gift Recommendation System

**Live Demo:** `https://your-vercel-url.vercel.app`

GiftAI Atelier is a full-stack web application that recommends gifts from natural-language prompts, compares marketplace options, and supports user wishlists.

## Features

- AI-powered gift recommendations from user intent
- Reliable provider fallback flow for demo stability
- Product cards with detailed modal view
- Marketplace links for Amazon, Flipkart, Meesho, and Myntra
- Price comparison map in modal
- Firebase authentication and wishlist support
- Responsive UI with premium animated hero

## Tech Stack

- Frontend: HTML, CSS, JavaScript, Vite
- Backend: Node.js, Express
- AI Providers: Groq, Gemini
- Fallback: Curated deterministic recommendation engine
- Auth/Storage: Firebase (Auth + Firestore)

## AI Pipeline

1. Groq (primary)
2. Gemini (secondary)
3. Curated fallback (final safety layer)

If Groq fails, Gemini is attempted automatically. If both fail, curated fallback guarantees recommendations.

## Recommendation Flow

1. Parse user prompt (`recipient`, `interest`, `occasion`, `budget`)
2. Build recommendation context
3. Request AI output via provider chain
4. Normalize recommendation objects
5. Ensure marketplace links and prices exist
6. Render cards and modal with rationale and comparison data

## Screenshots

![Home](./screenshots/home.png)
![Recommendations](./screenshots/recommendations.png)
![Product Modal](./screenshots/modal.png)

## Local Setup

1. Clone the repository
2. Install dependencies:
   - `npm install`
3. Create env file:
   - Copy `.env.example` to `.env`
4. Add keys in `.env`
5. Run:
   - `npm run dev`
6. Open:
   - `http://localhost:5173`

## Environment Variables

Use `.env` (do not commit):

- `GROQ_API_KEY=`
- `GEMINI_API_KEY=`
- `PORT=8787`

## Deployment (Vercel)

1. Push repository to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel settings
4. Build command: `npm run build`
5. Start command: `npm run start`

## Viva-Friendly Explanation

GiftAI Atelier solves a practical recommendation problem by combining:

- **NLP-style context extraction** from user text
- **LLM orchestration** with fallback reliability
- **Deterministic normalization** for stable UI rendering
- **Marketplace comparison UX** to support quick decision-making

This architecture is robust for demos because output remains available even when external AI providers fail.
