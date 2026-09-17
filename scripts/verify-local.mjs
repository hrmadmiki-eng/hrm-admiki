import '../server/config/env.js';
const api = `http://localhost:${process.env.PORT || 5000}/api`;
const health = await fetch(`${api}/health`);
if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
console.log('API health:', (await health.json()).data.status);
const web = await fetch(process.env.CLIENT_URL);
if (!web.ok || !(await web.text()).includes('root'))
  throw new Error('Frontend did not serve the application');
console.log('Frontend: available');
const login = await fetch(`${api}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: new URL(process.env.CLIENT_URL).origin },
  body: JSON.stringify({
    email: process.env.INITIAL_ADMIN_EMAIL || 'admin@admiki.com',
    password: process.env.INITIAL_ADMIN_PASSWORD,
  }),
});
const body = await login.json();
if (!login.ok) throw new Error(`Initial Admin login failed: ${body.message}`);
console.log(
  'Initial Admin login:',
  body.data.role,
  'password change required:',
  body.data.mustChangePassword,
);
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const logout = await fetch(`${api}/auth/logout`, {
  method: 'POST',
  headers: { Origin: new URL(process.env.CLIENT_URL).origin, Cookie: cookie },
});
if (!logout.ok) throw new Error('Logout verification failed');
console.log('Verification session revoked. No secrets logged.');
