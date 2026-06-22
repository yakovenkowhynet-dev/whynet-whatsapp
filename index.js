const express = require('express');
const { google } = require('googleapis');
const https = require('https');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID  = process.env.SPREADSHEET_ID;
const PIXEL_ID        = process.env.PIXEL_ID;
const ACCESS_TOKEN    = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const PORT            = process.env.PORT || 3000;

function hashPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  return crypto.createHash('sha256').update(clean).digest('hex');
}

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
        '',
      ]],
    },
  });
}

async function sendConversionEvent(lead) {
  const payload = JSON.stringify({
    data: [{
      event_name: 'InitiatedCheckout',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'other',
      user_data: {
        ph: [hashPhone(lead.phone)],
        ctwa_clid: lead.ctwa_clid,
      },
      custom_data: {
        ad_id: lead.ad_id,
      },
    }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('[CAPI RESPONSE]', data);
        resolve(data);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
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

    try {
      await sendConversionEvent(lead);
      console.log('[CAPI] Event sent');
    } catch (err) {
      console.error('[CAPI ERROR]', err.message);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
