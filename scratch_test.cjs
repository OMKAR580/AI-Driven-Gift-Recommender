const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const key = env.split('=')[1].trim();

const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.0-pro'];

async function test() {
  for (const m of models) {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'hello' }] }]
            })
        });
        console.log(m, res.status);
    } catch (e) {
        console.log(m, 'error', e.message);
    }
  }
}
test();
