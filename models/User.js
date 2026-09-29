const mongoose = require('mongoose');

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

module.exports = mongoose.model('User', userSchema);