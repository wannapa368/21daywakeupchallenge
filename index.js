process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');

const { createWakeUpFlexMessage } = require('./utils/flexMessage');

const DB_FILE = path.join(__dirname, 'database.json');

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

const middlewareConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const clientConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const client = new line.messagingApi.MessagingApiClient(clientConfig);
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.post('/webhook', line.middleware(middlewareConfig), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

app.post('/api/save-record', async (req, res) => {
    const { userId, wakeUpTime, activities } = req.body;
    try {
        const db = readDB();
        let user = db.users.find(u => u.userId === userId);

        if (!user) {
            user = { userId: userId, startDate: new Date(), checkIns: [], isCompleted: false };
            db.users.push(user);
        }

        user.checkIns.push({
            date: new Date(),
            wakeUpTime,
            activities
        });

        const dayCount = user.checkIns.length;
        const percent = Math.min(Math.round((dayCount / 21) * 100), 100);

        if (dayCount >= 21) {
            user.isCompleted = true;
        }

        writeDB(db);

        const flexMessage = createWakeUpFlexMessage(dayCount, wakeUpTime, activities);

        await client.pushMessage({
            to: userId,
            messages: [flexMessage]
        });

        res.json({ success: true, dayCount, percent });
    } catch (error) {
        console.error('Save record error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

app.get('/api/user-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const db = readDB();
        const user = db.users.find(u => u.userId === userId);

        if (!user) {
            return res.json({ success: true, checkIns: [], startDate: new Date() });
        }
        res.json({ success: true, checkIns: user.checkIns, startDate: user.startDate });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userText = event.message.text.trim();
    const userId = event.source.userId;
    let replyMessage = '';

    try {
        const db = readDB();
        let user = db.users.find(u => u.userId === userId);

        if (userText === 'เริ่มชาเลนจ์') {
            if (!user) {
                user = { userId: userId, startDate: new Date(), checkIns: [], isCompleted: false };
                db.users.push(user);
                writeDB(db);
                replyMessage = "ยินดีต้อนรับสู่ 21 Day Wake Up Challenge! ข้อมูลของคุณถูกลงทะเบียนแล้ว เริ่มบันทึกเวลาตื่นได้เลยครับ";
            } else {
                const count = user.checkIns.length;
                const pct = Math.min(Math.round((count / 21) * 100), 100);
                replyMessage = `คุณได้ลงทะเบียนเข้าร่วมชาเลนจ์ไว้แล้วครับ ปัจจุบันทำไปแล้ว ${count}/21 วัน (${pct}%)`;
            }
        } else if (userText === 'สถิติ') {
            if (!user || user.checkIns.length === 0) {
                replyMessage = "คุณยังไม่มีประวัติการเช็คอิน เริ่มต้นภารกิจได้โดยการบันทึกเวลาตื่นนะครับ";
            } else {
                const count = user.checkIns.length;
                const pct = Math.min(Math.round((count / 21) * 100), 100);
                replyMessage = `📊 สถิติความก้าวหน้าของคุณ:\n- ทำสำเร็จ: Day ${count} / 21 วัน\n- คิดเป็น: ${pct}%\n\nสู้ๆ ครับ ใกล้ความจริงแล้ว!`;
            }
        } else {
            replyMessage = 'สามารถเลือกเมนู "บันทึกเวลาตื่น" หรือพิมพ์คำว่า "สถิติ" เพื่อดูความคืบหน้าได้เลยครับ';
        }
    } catch (error) {
        console.error('Database query error:', error);
        replyMessage = 'ขออภัยครับ เกิดข้อผิดพลาดในระบบ โปรดลองใหม่อีกครั้ง';
    }

    return client.replyMessage({
        replyToken: event.replyToken,
        messages: [
            {
                type: 'text',
                text: replyMessage
            }
        ]
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});