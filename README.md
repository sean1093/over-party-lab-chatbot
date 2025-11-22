# Over Party Lab Chatbot

A LINE chatbot built with Google Apps Script and TypeScript for [Over Party Lab](https://www.instagram.com/over.party.lab/). This bot helps users search for cocktail recipes and recommendations through LINE Messaging API.

![logo](image/logo.jpg "logo")

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Cocktail Search**: Query cocktail recipes by name (English or Chinese)
- **Smart Recommendations**: Get ingredient-based cocktail suggestions when exact match is not found
- **Interactive Buttons**: User-friendly button templates for browsing recommendations
- **User Activity Tracking**: Logs user interactions to Google Sheets for analytics
- **Automated Deployment**: Use clasp for seamless Google Apps Script deployment

## Tech Stack

- **Runtime**: Google Apps Script
- **Language**: TypeScript
- **Messaging Platform**: LINE Messaging API
- **Data Storage**: Google Sheets
- **Development Tools**: clasp (Command Line Apps Script Projects)

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
│  LINE User  │─────▶│  Google Apps     │─────▶│   Google    │
│             │◀─────│  Script (Bot)    │◀─────│   Sheets    │
└─────────────┘      └──────────────────┘      └─────────────┘
                              │
                              │ Data lookup
                              ▼
                     Cocktail & Element
                        Mapping Data
```

## Prerequisites

- Node.js v12.0.0 or later
- npm or yarn
- Google Account
- LINE Developer Account
- LINE Messaging API Channel

## Installation

### 1. Install Dependencies

```bash
# Install clasp globally
npm install -g @google/clasp

# Install project dependencies
npm install
```

### 2. Setup Google Apps Script

```bash
# Login to Google Account
clasp login

# Create a new Apps Script project (or clone existing one)
clasp create --type webapp --title "Over Party Lab Chatbot"

# Or clone existing project
clasp clone <SCRIPT_ID>
```

### 3. Configure Environment

Create a `config.ts` file in the root directory (see `config.ts.example` for template):

```typescript
const CONFIG = {
  LINE: {
    CHANNEL_ACCESS_TOKEN: 'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
    URL_LINE: 'https://api.line.me/v2/bot/message/'
  },
  GOOGLE_SHEET: {
    API_KEY: 'YOUR_GOOGLE_SHEET_ID'
  },
  COLUMN_KEY_MAPPING: {
    name: 1,
    nameen: 2,
    link: 3,
    detail: 4,
    recommendation: 5
  },
  OVERPARTYLAB: {
    IG: 'https://www.instagram.com/over.party.lab/'
  },
  CONFIG_DEBUG: {
    USERID: 'YOUR_LINE_USER_ID_FOR_TESTING'
  }
};

export default CONFIG;
```

### 4. Setup Google Sheets

Create a Google Sheet with the following tabs:

- **DRINK_LIST**: Contains cocktail data
  - Columns: `name`, `nameen`, `link`, `detail`
- **ELEMENT_MAPPING**: Contains ingredient recommendations
  - Columns: `name`, `nameen`, `recommendation`
- **USER_ACTION**: Logs user interactions
  - Columns: `index`, `search`, `user`, `time`

### 5. Deploy

```bash
# Push code to Google Apps Script
clasp push

# Deploy as web app
clasp deploy
```

### 6. Configure LINE Webhook

1. Get your web app URL from Google Apps Script
2. Go to LINE Developers Console
3. Set webhook URL to your deployed Google Apps Script URL
4. Enable webhook

## Development

### Push & Pull Code

```bash
# Pull latest code from Google Apps Script
clasp pull

# Push local changes to Google Apps Script
clasp push

# Watch for changes and auto-push
clasp push --watch
```

### Testing

Use the debug functions in `debug.ts`:

```typescript
// Test POST endpoint
test_post();

// Test sending message
test_send();
```

## Project Structure

```
.
├── app.ts              # Main application logic and webhook handler
├── lineService.ts      # LINE Messaging API service
├── sheetService.ts     # Google Sheets operations
├── logService.ts       # Logging utility
├── timeService.ts      # Time formatting utility
├── wording.ts          # Response message templates
├── debug.ts            # Testing utilities
├── config.ts           # Configuration (gitignored)
├── appsscript.json     # Apps Script manifest
├── package.json        # Node.js dependencies
└── tsconfig.json       # TypeScript configuration
```

## How It Works

1. **User sends message** via LINE
2. **Webhook triggers** `doPost()` function in Google Apps Script
3. **Bot parses message** and searches Google Sheets for matching cocktail
4. **If found**: Returns cocktail details and link
5. **If not found**: Searches for ingredient-based recommendations
6. **Bot responds** with text or button template messages
7. **User action logged** to Google Sheets

## API Reference

### Main Functions

- `doPost(e)`: Webhook handler for LINE messages
- `lineService.pushMsg(config)`: Send messages to LINE
- `sheetService.query(params)`: Query Google Sheets data
- `sheetService.save(params)`: Save user actions

## Configuration

### appsscript.json

```json
{
  "timeZone": "Asia/Hong_Kong",
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  },
  "exceptionLogging": "STACKDRIVER"
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Resources

- [How to create a LINE chatbot using Google Apps Script](https://medium.com/@sean1093/%E5%85%A9%E5%B0%8F%E6%99%82%E6%89%93%E9%80%A0%E7%B0%A1%E5%96%AE-line-chatbot-%E4%BD%BF%E7%94%A8-google-apps-script-google-sheet-api-8fff7372ff3d)
- [Using clasp and TypeScript to develop Google Apps Script](https://medium.com/@sean1093/%E4%BD%BF%E7%94%A8-clasp-%E8%BC%95%E9%AC%86%E4%BD%BF%E7%94%A8-typescript-%E9%96%8B%E7%99%BC-google-apps-script-b93b60e93292)
- [LINE Messaging API Documentation](https://developers.line.biz/en/docs/messaging-api/)
- [Google Apps Script Documentation](https://developers.google.com/apps-script)
- [clasp Documentation](https://github.com/google/clasp)

## Author

**Sean Chou** - [GitHub](https://github.com/sean1093)

## Acknowledgments

- [Over Party Lab](https://www.instagram.com/over.party.lab/) - Cocktail community
- LINE Messaging API
- Google Apps Script Platform





