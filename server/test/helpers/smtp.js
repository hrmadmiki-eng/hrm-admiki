import net from 'node:net';

// Local SMTP capture server for end-to-end delivery checks; never sends external mail.
export async function startTestSmtp() {
  const messages = [];
  const sockets = new Set();
  const mailbox = { messages, rejectMessages: false };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '',
      data = null,
      recipients = [],
      authenticated = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (data !== null) {
          if (line !== '.') {
            data.push(line.replace(/^\.\./, '.'));
            continue;
          }
          if (mailbox.rejectMessages) socket.write('451 Temporary test failure\r\n');
          else {
            const raw = data.join('\r\n');
            const [headers, ...body] = raw.split('\r\n\r\n');
            let text = body.join('\r\n\r\n');
            if (/Content-Transfer-Encoding: quoted-printable/i.test(headers))
              text = text
                .replace(/=\r\n/g, '')
                .replace(/=([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            if (/Content-Transfer-Encoding: base64/i.test(headers))
              text = Buffer.from(text, 'base64').toString('utf8');
            messages.push({ to: [...recipients], text, headers });
            socket.write('250 Message accepted\r\n');
          }
          data = null;
          recipients = [];
        } else if (/^(EHLO|HELO) /i.test(line))
          socket.write(
            `250-localhost\r\n${mailbox.auth ? '250-AUTH PLAIN\r\n' : ''}250 PIPELINING\r\n`,
          );
        else if (/^AUTH PLAIN /i.test(line)) {
          const [, username, password] = Buffer.from(line.slice(11), 'base64')
            .toString()
            .split('\0');
          authenticated = username === mailbox.auth?.user && password === mailbox.auth?.pass;
          socket.write(authenticated ? '235 Authenticated\r\n' : '535 Invalid credentials\r\n');
        } else if (/^MAIL FROM:/i.test(line)) {
          recipients = [];
          socket.write(
            mailbox.auth && !authenticated ? '530 Authentication required\r\n' : '250 OK\r\n',
          );
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.match(/<([^>]+)>/)?.[1]);
          socket.write('250 OK\r\n');
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 End with dot\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  mailbox.port = server.address().port;
  mailbox.close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  };
  return mailbox;
}
