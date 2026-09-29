function createWakeUpFlexMessage(dayCount, wakeUpTime, activities) {
    // คำนวณเปอร์เซ็นต์ (เป้าหมาย 21 วัน)
    const percent = Math.min(Math.round((dayCount / 21) * 100), 100);

    return {
        type: "flex",
        altText: `บันทึกสำเร็จ! Day ${dayCount} (${percent}%)`,
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
                        text: `Day ${dayCount} / 21 (${percent}%)`,
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
}

module.exports = { createWakeUpFlexMessage };