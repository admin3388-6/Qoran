// كود إيقاف البوت وتعطيل الاتصال بديسكورد تماماً
const http = require('http');

// تشغيل السيرفر فقط ليرضي منصة Render ولا ينهار الـ Deployment
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot is suspended/offline.');
}).listen(process.env.PORT || 3000);

console.log("⚠️ تم تعطيل اتصال الديسكورد. البوت الآن Offline.");
