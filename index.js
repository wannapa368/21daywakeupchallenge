require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const { createWakeUpFlexMessage } = require('./utils/flexMessage');

let db;

// ฟังก์ชันเชื่อมต่อ SQLite และสร้างตาราง
async function initDB() {
    db = await open({
        filename: path.join(__dirname, 'database.sqlite'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            userId TEXT PRIMARY KEY,
            startDate TEXT,
            isCompleted INTEGER
        );

        CREATE TABLE IF NOT EXISTS check_ins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT,
            date TEXT,
            wakeUpTime TEXT,
            activities TEXT,
            FOREIGN KEY (userId) REFERENCES users(userId)
        );
    `);
    console.log('Connected to SQLite database successfully!');
}

initDB().catch(err => console.error('SQLite connection error:', err));

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

// API บันทึกเวลาตื่น
app.post('/api/save-record', async (req, res) => {
    const { userId, wakeUpTime, activities } = req.body;
    try {
        let user = await db.get(`SELECT * FROM users WHERE userId = ?`, [userId]);
        const nowStr = new Date().toISOString();

        if (!user) {
            await db.run(`INSERT INTO users (userId, startDate, isCompleted) VALUES (?, ?, ?)`, 
                [userId, nowStr, 0]);
        }

        // บันทึกประวัติการเช็คอิน (แปลง activities array เป็น JSON string)
        await db.run(`INSERT INTO check_ins (userId, date, wakeUpTime, activities) VALUES (?, ?, ?, ?)`,
            [userId, nowStr, wakeUpTime, JSON.stringify(activities)]);

        const checkIns = await db.all(`SELECT * FROM check_ins WHERE userId = ?`, [userId]);
        const dayCount = checkIns.length;
        const percent = Math.min(Math.round((dayCount / 21) * 100), 100);

        if (dayCount >= 21) {
            await db.run(`UPDATE users SET isCompleted = 1 WHERE userId = ?`, [userId]);
        }

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

// API ดึงประวัติผู้ใช้
app.get('/api/user-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await db.get(`SELECT * FROM users WHERE userId = ?`, [userId]);
        
        if (!user) {
            return res.json({ success: true, checkIns: [], startDate: new Date() });
        }

        const rawCheckIns = await db.all(`SELECT * FROM check_ins WHERE userId = ?`, [userId]);
        const checkIns = rawCheckIns.map(item => ({
            date: item.date,
            wakeUpTime: item.wakeUpTime,
            activities: JSON.parse(item.activities)
        }));

        res.json({ success: true, checkIns, startDate: user.startDate });
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
        let user = await db.get(`SELECT * FROM users WHERE userId = ?`, [userId]);

        if (userText === 'เริ่มชาเลนจ์') {
            if (!user) {
                const nowStr = new Date().toISOString();
                await db.run(`INSERT INTO users (userId, startDate, isCompleted) VALUES (?, ?, ?)`, 
                    [userId, nowStr, 0]);
                replyMessage = "ยินดีต้อนรับสู่ 21 Day Wake Up Challenge! ข้อมูลของคุณถูกลงทะเบียนแล้ว เริ่มบันทึกเวลาตื่นได้เลยครับ";
            } else {
                const checkIns = await db.all(`SELECT * FROM check_ins WHERE userId = ?`, [userId]);
                const count = checkIns.length;
                const pct = Math.min(Math.round((count / 21) * 100), 100);
                replyMessage = `คุณได้ลงทะเบียนเข้าร่วมชาเลนจ์ไว้แล้วครับ ปัจจุบันทำไปแล้ว ${count}/21 วัน (${pct}%)`;
            }
        } else if (userText === 'สถิติ') {
            const checkIns = user ? await db.all(`SELECT * FROM check_ins WHERE userId = ?`, [userId]) : [];
            if (!user || checkIns.length === 0) {
                replyMessage = "คุณยังไม่มีประวัติการเช็คอิน เริ่มต้นภารกิจได้โดยการบันทึกเวลาตื่นนะครับ";
            } else {
                const count = checkIns.length;
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