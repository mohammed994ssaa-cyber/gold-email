# Gold Alert

A complete Node.js website for monitoring gold prices in BHD/gram and emailing you when a selected purity reaches your target.

## Features
- 24K, 22K, 21K and 18K gold
- BHD/gram display
- User-defined target price
- Email alerts
- Multiple alerts
- Pause/resume/delete alerts
- SQLite database
- Responsive dashboard

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Add your Resend API key and verified sender domain.
4. Run `npm install`
5. Run `npm start`
6. Open http://localhost:3000

The default gold provider is xaus.com and the code expects an XAU/USD price in USD per gram, then converts it to BHD using the BHD/USD peg. Replace `GOLD_API_URL` with another provider if desired.

For production, deploy the Node server on a host that keeps background processes alive. Serverless hosting needs a scheduled/cron job instead of relying on setInterval.
