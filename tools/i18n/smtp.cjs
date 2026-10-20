const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function startSMTP(port = 4599) {
  const messages = [];
  const output = path.join(__dirname, 'out/smtp.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, '[]');
  const server = net.createServer(socket => {
    socket.write('220 localhost integration fixture\r\n');
    let pending = '', data = false, message = '';
    socket.on('data', bytes => {
      pending += bytes.toString();
      let index;
      while ((index = pending.indexOf('\r\n')) !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (data) {
          if (line === '.') {
            messages.push(message);
            fs.writeFileSync(output, JSON.stringify(messages, null, 2));
            data = false; message = '';
            socket.write('250 captured locally\r\n');
          }
          else message += line.replace(/^\.\./, '.') + '\r\n';
        }
        else if (/^(EHLO|HELO)/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if (/^DATA$/i.test(line)) { data = true; socket.write('354 End with dot\r\n'); }
        else if (/^QUIT$/i.test(line)) socket.end('221 Goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { messages, close: () => new Promise(resolve => server.close(resolve)) };
};
