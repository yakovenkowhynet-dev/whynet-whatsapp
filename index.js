const express = require('express');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID  = process.env.SPREADSHEET_ID;
const PORT            = process.env.PORT || 3000;

async function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function appendLead(lead) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:F',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        lead.phone,
        lead.ctwa_clid,
        lead.ad_id,
        lead.headline,
        lead.timestamp,
        '',   // quality — заполняется вручную
      ]],
    },
  });
}

// Верификация Webhook
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Приём событий
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  const message  = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const referral = message?.referral;

  if (referral?.source_type === 'ad') {
    const lead = {
      phone:     message.from,
      ctwa_clid: referral.ctwa_clid,
      ad_id:     referral.source_id,
      headline:  referral.headline || '',
      timestamp: message.timestamp,
    };

    console.log('[CTWA LEAD]', lead);

    try {
      await appendLead(lead);
      console.log('[SHEETS] Lead saved');
    } catch (err) {
      console.error('[SHEETS ERROR]', err.message);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
