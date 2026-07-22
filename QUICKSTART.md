# Quick Start Guide

## The Error You're Seeing

If you see this error:

```
Failed to load resource: the server responded with a status of 500
TypeError: Cannot read properties of undefined (reading 'split')
```

**This means:** The `LOVABLE_API_KEY` environment variable is not configured.

## How to Fix (2 minutes)

### Step 1: Create `.env` file

In the project root (same folder as `package.json`), create a file named `.env`:

```bash
# On Windows (PowerShell):
copy .env.example .env

# On Mac/Linux:
cp .env.example .env
```

### Step 2: Add your API key

Open `.env` and replace `your_api_key_here` with your actual Lovable API key:

```
LOVABLE_API_KEY=lovable_sk_abc123xyz...
```

**Where to get the API key:**
1. Go to https://lovable.dev
2. Sign in to your account
3. Navigate to Settings → API Keys
4. Copy your API key

### Step 3: Restart the server

Stop the current dev server (Ctrl+C) and restart:

```bash
npm run dev
```

## Verify It Works

Open http://localhost:3000 and try asking the AI:
- "Who spends the most time overall?"
- "Who spends the most time in Finance?"

You should see proper responses with inline citations like `[source: breakdown_by_employee[0].employee_name = "John"]`

## Security Note

**Never commit `.env` to git!** 

The `.env` file is already excluded in `.gitignore`. Only commit `.env.example` as a template.

## Still Having Issues?

See [SETUP.md](./SETUP.md) for detailed troubleshooting.

## What Changed?

The AI assistant has been upgraded to answer employee-level questions. See [AI_UPGRADE_SUMMARY.md](./AI_UPGRADE_SUMMARY.md) for details.
