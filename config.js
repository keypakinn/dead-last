// config.js — แก้เลขหลัง : ได้เลย แล้วอัปขึ้น GitHub (แก้ตอนไม่มีคนเล่น)
// ค่าที่ผิดชนิดหรืออยู่นอกช่วง เซิร์ฟเวอร์จะใช้ค่าเริ่มต้นแทนและเขียนคำเตือนใน log (R-3-02)
module.exports = {
  // ---------- เวลา (วินาที) ----------
  conspireSeconds: 90,        // เจรจาก่อนโหวตแต่ละครั้ง
  voteSeconds: 30,            // ช่วงโหวต
  ambushPickSeconds: 20,      // Ambush เลือกคนที่จะกำจัด
  showdownTalkSeconds: 60,    // เจรจาก่อนเลือกไพ่ Showdown
  showdownPickSeconds: 30,    // เลือกไพ่ Showdown
  resultSeconds: 8,           // แสดงผลก่อนไปขั้นถัดไป
  gmHandoverSeconds: 30,      // GM หลุดนานเท่านี้ ย้ายสิทธิ์ GM
  roomIdleMinutes: 30,        // ไม่มีใครออนไลน์นานเท่านี้ (นาที) ลบห้อง

  // ---------- ผู้เล่นและการชนะ ----------
  minPlayers: 6,
  maxPlayers: 12,
  largeGroupFrom: 10,         // ผู้เล่นตั้งแต่จำนวนนี้ใช้เกณฑ์ winPointsLarge
  winPointsSmall: 25,
  winPointsLarge: 24,
  tiebreakMaxShowdowns: 3,    // Tie-break ได้สูงสุดกี่ครั้ง แล้วชนะร่วม

  // ---------- ทอง ----------
  deckCount3: 26,             // จำนวนแท่งค่า 3
  deckCount4: 43,             // จำนวนแท่งค่า 4
  deckCount5: 11,             // จำนวนแท่งค่า 5
  potSize: 4,                 // แท่งในกองกลางต่อรอบ
  compensationBars: 1,        // ทองชดเชยต่อคน

  // ---------- แชท ----------
  chatMaxLength: 200,         // ตัวอักษรสูงสุดต่อข้อความ
  chatMinIntervalMs: 1000,    // ส่งได้ 1 ข้อความต่อเวลาเท่านี้ (มิลลิวินาที)
  chatHistory: 100,           // จำนวนข้อความล่าสุดที่เก็บไว้ต่อห้อง

  // ---------- ตัวเลือกกฎ ----------
  zeroSurvivorCompensation: true,  // ไม่มีผู้รอด: true = คนที่ตกรอบก่อนได้ชดเชย, false = ไม่มีใครได้
  hiddenScores: true,              // true = ซ่อนแต้มคนอื่นจนจบเกม
  showdownTimeoutChoice: 'share',  // 'share' | 'grab' | 'random'
  ambushTimeoutPick: 'random',     // 'random' | 'none'
};
