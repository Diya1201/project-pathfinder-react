# Setup Instructions

## Prerequisites

1. Node.js (v18 or higher)
2. npm or yarn package manager
3. Lovable AI Gateway API Key

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   
   Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Lovable API key:
   ```
   LOVABLE_API_KEY=your_actual_api_key_here
   ```
   
   **To get your API key:**
   - Visit https://lovable.dev
   - Sign in to your account
   - Navigate to API settings
   - Copy your API key

3. **Run the development server:**
   ```bash
   npm run dev
   ```
   
   The application will be available at `http://localhost:3000`

4. **Build for production:**
   ```bash
   npm run build
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LOVABLE_API_KEY` | Yes | API key for Lovable AI Gateway (Gemini 2.5 Flash) |

## Troubleshooting

### Error: "LOVABLE_API_KEY is not configured"

**Symptom:** AI chat returns 500 error, console shows server error

**Solution:**
1. Verify `.env` file exists in project root
2. Ensure `LOVABLE_API_KEY` is set in `.env`
3. Restart the development server after adding/changing `.env`
4. Check that `.env` is not in `.gitignore` (only `.env.local` should be ignored)

### Error: "Cannot read properties of undefined (reading 'split')"

**Symptom:** Frontend crashes when AI response fails

**Solution:** 
- This has been fixed in the latest version with proper null checks
- Ensure you have the updated `AIChat.tsx` with `if (!text) return null;` check

### Data not loading

**Symptom:** Dashboard shows no data

**Solution:**
1. Ensure `public/data/employees.json` exists
2. Ensure `public/data/activity_logs.csv` exists
3. Check browser console for data loading errors
4. Verify JSON/CSV file format is correct

## Project Structure

```
project-pathfinder-react/
├── src/
│   ├── components/        # React components
│   │   └── AIChat.tsx     # AI assistant chat interface
│   ├── lib/
│   │   ├── normalize.ts   # Data normalization pipeline
│   │   ├── analytics.ts   # Analytics calculations
│   │   └── ai.functions.ts # Server-side AI functions
│   └── routes/            # TanStack Router pages
├── public/
│   └── data/              # Employee & activity data
│       ├── employees.json
│       └── activity_logs.csv
├── .env                   # Environment variables (DO NOT COMMIT)
├── .env.example           # Environment template (safe to commit)
└── package.json
```

## Development Workflow

1. Make changes to source files
2. Hot reload automatically updates browser
3. Check console for TypeScript/build errors
4. Test AI queries in chat interface
5. Build and verify before deploying

## AI Assistant Testing

Test these queries to verify functionality:

- "Who spends the most time overall?"
- "Who spends the most time in Finance?"
- "Who performs the most Email Triage?"
- "Which employee has the highest repetitive task share?"
- "Why is Email Triage ranked #1?"
- "Compare Finance with HR"
- "Show only Sales" → "Break that down by task"

All responses should include inline citations like `[source: field = value]`.

## Deployment

This project is configured for Cloudflare Pages deployment:

1. Build: `npm run build`
2. Deploy `.output/` directory to Cloudflare
3. Set `LOVABLE_API_KEY` in Cloudflare environment variables
4. Ensure compatibility date is set correctly

## Support

For issues or questions:
1. Check this SETUP.md file
2. Review AI_UPGRADE_SUMMARY.md for recent changes
3. Check AGENTS.md for Lovable-specific guidelines
