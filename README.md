# Prep Studio

Prep Studio is a full-stack job search and workflow automation app. It combines a FastAPI backend with a React + Vite frontend, AI-powered planning, job workflows, alerts, and channel integrations.

## Tech stack

- Backend: Python, FastAPI, Motor/MongoDB
- Frontend: React, TypeScript, Vite, Tailwind
- AI: LangChain + OpenAI / Gemini / Claude
- MCP server: Python-based MCP service for workflow tools

## Repository structure

- `backend/` — FastAPI app, workflow logic, agents, routers, DB access
- `frontend/` — React app
- `.gitignore` — project ignore rules

## Prerequisites

Before you start, install:

- Python 3.11+
- Node.js 18+
- npm
- MongoDB running locally or reachable via connection string
- Optional: API keys for OpenAI / Gemini / Claude

## 1) Clone the repo

```bash
git clone <your-repo-url>
cd prep-studio
```

## 2) Backend setup

```bash
cd backend
python -m venv .venv
```

On Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

On macOS/Linux:

```bash
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create a local environment file:

```bash
copy NUL .env
```

or:

```bash
touch .env
```

Add values like:

```env
MONGO_URL=mongodb://localhost:27017
MONGO_DB=prep_studio
OPENAI_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
CLAUDE_API_KEY=your_key_here
```

If needed, adjust any provider config and ports in `backend/config.py`.

Start the backend API:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

This should run the main API at:

- http://localhost:8000

## 3) MCP server setup

In a separate terminal:

```bash
cd backend
. .venv\Scripts\Activate.ps1
python -m mcp_server.server
```

This starts the MCP server used by the AI workflow tooling.

## 4) Frontend setup

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Then open:

- http://localhost:5173

## 5) Common project commands

Backend:

```bash
cd backend
. .venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
cd frontend
npm run build
```

## 6) MongoDB

Make sure MongoDB is running locally and reachable at the configured Mongo URL. The default app config uses:

```text
mongodb://localhost:27017
```

and database name:

```text
prep_studio
```

## 7) Troubleshooting

- If the API fails to start, check that your Python venv is active and dependencies are installed.
- If the frontend cannot reach the backend, ensure the backend is running on port 8000.
- If AI features fail, confirm your provider keys are set in the backend `.env` file and that the model supports the workflow.
- If the workflow backend or MCP server is not working, make sure the MCP process is running separately on port 8001.

## 8) Notes

- All sensitive API keys should stay on the backend side and be stored in environment variables or server settings.
- The frontend should not own raw provider secrets.

## License

This project is for local development and internal use unless a separate license is added.
