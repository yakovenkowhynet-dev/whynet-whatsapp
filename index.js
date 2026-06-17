const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;   // придумай сам
const PORT = process.env.PORT || 3000;

// Верификация Webhook (Meta делает GET при настройке)
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Приём входящих событий от Meta
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  const entry    = body.entry?.[0];
  const change   = entry?.changes?.[0];
  const value    = change?.value;
  const messages = value?.messages;

  if (!messages?.length) return res.sendStatus(200);

  const message  = messages[0];
  const referral = message.referral;

  if (referral?.source_type === 'ad') {
    const lead = {
      phone:      message.from,            // номер пользователя
      ctwa_clid:  referral.ctwa_clid,      // ключ атрибуции
      ad_id:      referral.source_id,      // ID объявления
      headline:   referral.headline,       // заголовок объявления
      timestamp:  message.timestamp,
    };

    console.log('[CTWA LEAD]', JSON.stringify(lead, null, 2));
    // TODO шаг 3: сохранить lead в БД
    // TODO шаг 4: отправить событие в Conversions API
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
