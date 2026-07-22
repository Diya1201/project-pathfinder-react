# Local Development Setup

## Issue: AI Chat Returns 500 Error

The AI chat functionality requires the `LOVABLE_API_KEY` environment variable to be set. This key is automatically provisioned in the Lovable deployment but needs to be configured for local development.

## Solution

### Option 1: Create .env file (Recommended)

1. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Lovable API key:
   ```
   LOVABLE_API_KEY=your_actual_api_key_here
   ```

3. Restart the dev server:
   ```bash
   # Stop the current server (Ctrl+C)
   npm run dev
   ```

### Option 2: Set environment variable in terminal

**PowerShell (Windows):**
```powershell
$env:LOVABLE_API_KEY="your_api_key_here"
npm run dev
```

**Bash/Zsh (Mac/Linux):**
```bash
export LOVABLE_API_KEY="your_api_key_here"
npm run dev
```

## Getting Your API Key

1. If this project is deployed on Lovable, check your deployment settings
2. Or generate a new key from your Lovable account: https://lovable.dev
3. Contact your project administrator for the existing key

## Verification

Once configured correctly:

1. The dev server should start without API key errors
2. AI chat queries should return responses
3. No 500 errors in browser console

## Testing Without API Key

If you don't have an API key yet, you can still:
- ✅ View the dashboard
- ✅ Use filters and cross-filtering
- ✅ View employee profiles
- ✅ Export PDF
- ❌ Cannot use AI chat (requires API key)

## Current Implementation Status

✅ **Employee-level activity data** is successfully added to grounding
✅ **Client-side fixes** prevent crashes when AI returns no response
✅ **Ready to test** once API key is configured

The implementation is complete—only the API key configuration is needed for local AI chat testing.
