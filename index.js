process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const mongoose = require('mongoose');

const { createWakeUpFlexMessage } = require('./utils/flexMessage');

// เชื่อมต่อ MongoDB Atlas (ปรับปรุงใหม่ ตัด option ที่ไม่รองรับออก)
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log('Connected to MongoDB successfully');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// กำหนด Schema ของผู้ใช้งาน
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    startDate: { type: Date, default: Date.now },
    isCompleted: { type: Boolean, default: false },
    checkIns: [{
        date: { type: Date, required: true },
        wakeUpTime: String,
        activities: [String]
    }]
});

const User = mongoose.model('User', userSchema);

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.post('/webhook', line.middleware(config), (req, res) => {
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
        let user = await User.findOne({ userId });
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

        if (!user) {
            user = new User({
                userId,
                startDate: new Date(),
                checkIns: [],
                isCompleted: false
            });
        } else {
            // เช็คว่าวันนี้เคยบันทึกไปแล้วหรือยัง (เทียบด้วยเวลาไทย)
            const alreadyCheckedIn = user.checkIns.some(checkIn => {
                const checkInDateStr = new Date(checkIn.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
                return checkInDateStr === todayStr;
            });

            if (alreadyCheckedIn) {
                return res.status(200).json({ 
                    success: false, 
                    error: 'คุณได้บันทึกเวลาตื่นของวันนี้ไปเรียบร้อยแล้วครับ ไว้บันทึกใหม่อีกครั้งพรุ่งนี้นะครับ!' 
                });
            }
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

        await user.save();

        const flexMessage = createWakeUpFlexMessage(dayCount, wakeUpTime, activities);
        await client.pushMessage(userId, flexMessage);

        res.json({ success: true, dayCount, percent });
    } catch (error) {
        console.error('Save record error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

app.get('/api/user-history/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await User.findOne({ userId });

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
        let user = await User.findOne({ userId });

        if (userText === 'เริ่มชาเลนจ์') {
            if (!user) {
                user = new User({ userId, startDate: new Date(), checkIns: [], isCompleted: false });
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
        replyMessage = 'ขออภัยครับ เกิดข้อผิดพลาดในระบบ โปรดลองใหม่อีกครั้ง';
    }

    return client.replyMessage(event.replyToken, {
        type: 'text',
        text: replyMessage
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});