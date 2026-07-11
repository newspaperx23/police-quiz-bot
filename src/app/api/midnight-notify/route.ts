import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * POST /api/midnight-notify
 * Triggered by Vercel Cron at UTC 17:00 (Thai midnight 00:00).
 * Sends exam countdown + streak reminder to all awake users.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get("authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
    const isVercelCron = request.headers.get("x-vercel-cron") === "true";

    if (!isVercelCron && (!authHeader || authHeader !== expectedToken)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Calculate days left until exam (Nov 29, 2026)
    const examDate = new Date("2026-11-29T00:00:00+07:00");
    const now = new Date();
    const daysLeft = Math.max(0, Math.ceil((examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    // Today's date string in Thai timezone (Asia/Bangkok)
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

    // Fetch all awake users
    const snapshot = await db.collection("users").where("isAwake", "==", true).get();

    if (snapshot.empty) {
      return Response.json({ message: "No awake users", sent: 0 });
    }

    let sentCount = 0;

    for (const doc of snapshot.docs) {
      const chatId = doc.id;
      const userData = doc.data();

      // Check streak status
      const lastAnswerDate = userData.lastAnswerDate || null;
      const currentStreak = userData.currentStreak || 0;
      const answered = userData.quizzesAnswered || 0;
      const correct = userData.quizzesCorrect || 0;
      const rate = answered > 0 ? ((correct / answered) * 100).toFixed(1) : "0.0";

      // Did user answer today?
      const didAnswerToday = lastAnswerDate === todayStr;

      let streakLine = "";
      if (didAnswerToday) {
        streakLine = `🔥 <b>Streak:</b> ${currentStreak} วันติดต่อกัน — เยี่ยมมาก!`;
      } else if (currentStreak > 0) {
        streakLine = `⚠️ <b>วันนี้ยังไม่ได้ทำข้อสอบ!</b> Streak ${currentStreak} วันจะหายถ้าไม่ทำข้อสอบวันนี้!`;
      } else {
        streakLine = `💪 เริ่มต้น Streak วันแรกได้เลย! มาทำข้อสอบวันนี้กัน`;
      }

      const message =
        `🌙 <b>สรุปประจำวัน</b>\n\n` +
        `📅 <b>นับถอยหลังสอบนายสิบตำรวจ:</b>\n` +
        `🚔 เหลือเวลาเตรียมตัวอีก <b>${daysLeft} วัน</b> (สอบ 29 พ.ย. 69)\n\n` +
        `${streakLine}\n` +
        `📈 อัตราตอบถูกรวม: ${rate}%\n\n` +
        `ฝึกทำข้อสอบทุกวัน สู้ๆ ครับ! 👮‍♂️✨`;

      try {
        await sendMessage(chatId, message, "HTML");
        sentCount++;
        // Rate limit: 100ms delay between messages
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        console.error(`Midnight notify error for ${chatId}:`, err);
      }
    }

    return Response.json({ message: "Midnight notify complete", sent: sentCount });
  } catch (error) {
    console.error("Midnight notify error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Support GET for testability and older Cron triggers
export async function GET(request: NextRequest) {
  return POST(request);
}
