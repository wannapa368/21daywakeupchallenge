require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const mongoose = require('mongoose');

// นำเข้าโมเดลและฟังก์ชันที่แยกไว้
const User = require('./models/User');
const { createWakeUpFlexMessage } = require('./utils/flexMessage');

// เชื่อมต่อ MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));

// การตั้งค่า LINE Client และ Middleware
const middlewareConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const clientConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const client = new line.messagingApi.MessagingApiClient(clientConfig);

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Webhook สำหรับดักรับ Event จาก LINE Bot
app.post('/webhook', line.middleware(middlewareConfig), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// API สำหรับรับข้อมูลการเช็คอินจาก LIFF Frontend (liff.html)
app.post('/api/save-record', async (req, res) => {
    const { userId, wakeUpTime, activities } = req.body;
    try {
        let user = await User.findOne({ userId: userId });
        if (!user) {
            user = new User({ userId: userId, checkIns: [] });
        }
        
        user.checkIns.push({ wakeUpTime, activities });
        const dayCount = user.checkIns.length;
        const percent = Math.min(Math.round((dayCount / 21) * 100), 100);

        if (dayCount >= 21) {
            user.isCompleted = true;
        }

        await user.save();

        // สร้าง Flex Message จากโมดูลย่อย
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

// API สำหรับดึงประวัติและข้อมูลชาเลนจ์ของผู้ใช้ (รองรับ history.html และ challenges.html)
app.get('/api/user-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await User.findOne({ userId: userId });
        if (!user) {
            return res.json({ success: true, checkIns: [], startDate: new Date() });
        }
        res.json({ success: true, checkIns: user.checkIns, startDate: user.startDate });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// ฟังก์ชันจัดการข้อความแชท
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userText = event.message.text.trim();
    const userId = event.source.userId;
    let replyMessage = '';

    try {
        let user = await User.findOne({ userId: userId });

        if (userText === 'เริ่มชาเลนจ์') {
            if (!user) {
                user = new User({ userId: userId, checkIns: [] });
                await user.save();
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
        replyMessage = 'ขออภัยครับ เกิดข้อผิดพลาดในระบบฐานข้อมูล โปรดลองใหม่อีกครั้ง';
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