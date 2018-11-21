const path = require('path');
const crypto = require('crypto');
const Koa = require('koa');
const serve = require('koa-static');
const handlebars = require('koa-handlebars');
const WebSocket = require('ws');
const router = require('koa-router')();
const axios = require('axios');

const mpConfig = require('./mpConfig');

const instance = axios.create({
  baseURL: 'https://api.maqpie.com/',
  headers: { 'Authorization': `Bearer ${mpConfig.apiToken}` },
});

const ids = {
  first: `${(new Date).getTime()}-jane`,
  second: `${(new Date).getTime()}-john`,
};

const users = {
  first: {
    vendorId: ids.first, 
    hash: crypto.createHmac('sha256', mpConfig.secretKey).update(ids.first).digest('hex'),
    avatarUrl: 'http://localhost:3000/jane_avatar.jpeg',
    firstName: 'Jane',
    lastName: 'Northon',
    username: 'Jane Northon',
    email: "jane@example.com",
  },
  second: {
    vendorId: ids.second,
    hash: crypto.createHmac('sha256', mpConfig.secretKey).update(ids.second).digest('hex'),
    avatarUrl: 'http://localhost:3000/john_avatar.jpeg',
    firstName: 'John',
    lastName: 'Smith',
    username: 'John Smith',
    email: "john@example.com",
  },
};

instance.post(`/integration/users/bulk-add?appId=${mpConfig.appId}`, {
  users: Object.values(users),
});

const app = new Koa();
app.use(handlebars({
  root: __dirname,
  viewsDir: 'templates'
}));
app.use(serve(path.join(__dirname, 'static')));

router.get('/jane', async ctx => {
  await ctx.render('jane', { appId: mpConfig.appId, user: users.first });
});
router.get('/john', async ctx => {
  await ctx.render('john', { appId: mpConfig.appId, user: users.second });
});
app.use(router.routes());

app.listen(3000);

const wss = new WebSocket.Server({ port: 3001 });
const connects = {
  john: [],
  jane: [],
};

const data = {
  isCreatedOffer: false,
  isAcceptedOffer: false,
};

wss.on('connection', ws => {
  ws.on('message', message => {
    const pMessage = JSON.parse(message);
    switch (pMessage.type) {
      case 'init':
        connects[pMessage.user].push(ws);
        if (pMessage.user === 'john' && data.isCreatedOffer && !data.isAcceptedOffer) {
          ws.send(JSON.stringify({ type: 'contactOffer' }));
        }
        if (pMessage.user === 'jane' && data.isCreatedOffer && data.isAcceptedOffer) {
          ws.send(JSON.stringify({ type: 'offerAccepted', userId: users.second.vendorId }));
        }
        break;
      case 'addToContacts':
        data.isCreatedOffer = true;
        connects.john.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'contactOffer' }));
          }
        });
        break;
      case 'offerAccepted':
        data.isAcceptedOffer = true;
        instance.post(`/integration/users/${users.second.vendorId}/contacts/add?appId=${mpConfig.appId}`, {
          contactIds: [users.first.vendorId],
        }).then(() => {
          connects.jane.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
              c.send(JSON.stringify({ type: 'offerAccepted', userId: users.second.vendorId }));
            }
          });
        });
        break;
      default:
        break;
    }
  });
});
