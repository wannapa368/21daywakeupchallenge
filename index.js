require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const mongoose = require('mongoose');

// เชื่อมต่อ MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));

// โครงสร้าง Schema สำหรับเก็บประวัติการเช็คอินและกิจกรรม
const checkInSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    wakeUpTime: String,
    activities: [String]
});

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    startDate: { type: Date, default: Date.now },
    checkIns: [checkInSchema],
    isCompleted: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

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

// Middleware สำหรับจัดการ JSON และเปิดโฟลเดอร์หน้าเว็บ static
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

// API สำหรับรับข้อมูลการเช็คอินและกิจกรรมจาก LIFF Frontend พร้อมส่ง Flex Message
app.post('/api/save-record', async (req, res) => {
    const { userId, wakeUpTime, activities } = req.body;
    try {
        let user = await User.findOne({ userId: userId });
        if (!user) {
            user = new User({ userId: userId, checkIns: [] });
        }
        
        user.checkIns.push({ wakeUpTime, activities });
        await user.save();

        const dayCount = user.checkIns.length;

        // โครงสร้าง Flex Message สรุปผลแบบมีการ์ดสวยงามและไอคอนรูปไฟ
        const flexMessage = {
            type: "flex",
            altText: `บันทึกสำเร็จ! Day ${dayCount}`,
            contents: {
                type: "bubble",
                header: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                        {
                            type: "text",
                            text: "🔥 21-Day Wake Up Challenge",
                            weight: "bold",
                            color: "#FF5722",
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: `Day ${dayCount} / 21`,
                            weight: "bold",
                            size: "xxl",
                            color: "#1DB446",
                            margin: "md"
                        }
                    ]
                },
                body: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                        {
                            type: "text",
                            text: `⏰ เวลาตื่น: ${wakeUpTime} น.`,
                            weight: "bold",
                            size: "md",
                            color: "#333333"
                        },
                        {
                            type: "separator",
                            margin: "md"
                        },
                        {
                            type: "text",
                            text: "กิจกรรมที่ทำวันนี้:",
                            weight: "bold",
                            size: "sm",
                            color: "#555555",
                            margin: "md"
                        },
                        {
                            type: "text",
                            text: activities.map(act => `• ${act}`).join('\n'),
                            size: "sm",
                            color: "#666666",
                            wrap: true,
                            margin: "sm"
                        }
                    ]
                }
            }
        };

        // ส่ง Flex Message กลับไปหาผู้ใช้ผ่าน LINE
        await client.pushMessage({
            to: userId,
            messages: [flexMessage]
        });

        res.json({ success: true, dayCount });
    } catch (error) {
        console.error('Save record error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// ฟังก์ชันสำหรับตอบกลับคำสั่งข้อความทางแชท
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
                replyMessage = `คุณได้ลงทะเบียนเข้าร่วมชาเลนจ์ไว้แล้วครับ ปัจจุบันทำไปแล้ว ${user.checkIns.length}/21 วัน`;
            }
        } else if (userText === 'สถิติ') {
            if (!user || user.checkIns.length === 0) {
                replyMessage = "คุณยังไม่มีประวัติการเช็คอิน เริ่มต้นภารกิจได้โดยการบันทึกเวลาตื่นนะครับ";
            } else {
                replyMessage = `สถิติของคุณ:\nทำสำเร็จไปแล้ว: Day ${user.checkIns.length} / 21 วัน ลุยต่อไปให้ครบ 21 วันนะครับ!`;
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