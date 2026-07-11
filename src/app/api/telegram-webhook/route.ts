import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { syllabusMap, SUBJECT_KEYS } from "@/lib/syllabus";
import { sendMessage } from "@/lib/telegram";
import { FieldValue } from "firebase-admin/firestore";
import { sendIndividualQuiz } from "@/lib/quiz";
import { sendIndividualVocabulary } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram-webhook
 * Handles incoming Telegram bot commands:
 *   /start  - Register user & activate quiz
 *   /sleep  - Pause quiz delivery
 *   /wake   - Resume quiz delivery
 *   /subject [name] - Change current subject
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ─── Handle Poll Answer webhook update ─────────────
    const pollAnswer = body?.poll_answer;
    if (pollAnswer) {
      const pollId = String(pollAnswer.poll_id).trim();
      const userChoice = pollAnswer.option_ids[0]; // selected option index

      const pollDoc = await db.collection("active_polls").doc(pollId).get();
      if (pollDoc.exists) {
        const pollData = pollDoc.data();
        if (pollData && !pollData.answered) {
          const { chatId, correctOptionId } = pollData;
          const isCorrect = userChoice === correctOptionId;

          const userRef = db.collection("users").doc(chatId);
          await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (userDoc.exists) {
              const uData = userDoc.data() || {};
              const currentAnswered = (uData.quizzesAnswered || 0) + 1;
              const currentCorrect = (uData.quizzesCorrect || 0) + (isCorrect ? 1 : 0);
              const currentIncorrect = (uData.quizzesIncorrect || 0) + (isCorrect ? 0 : 1);

              // ─── Daily Streak tracking ─────────────
              const now = new Date();
              const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // "YYYY-MM-DD"
              const lastAnswerDate = uData.lastAnswerDate || null;
              let currentStreak = uData.currentStreak || 0;
              let longestStreak = uData.longestStreak || 0;

              if (lastAnswerDate !== todayStr) {
                // Check if yesterday
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

                if (lastAnswerDate === yesterdayStr) {
                  currentStreak += 1; // consecutive day
                } else if (lastAnswerDate === null || lastAnswerDate < yesterdayStr) {
                  currentStreak = 1; // streak broken, restart
                }
                // else: lastAnswerDate is today already (no change, but we handle above)

                longestStreak = Math.max(longestStreak, currentStreak);
              }
              // If lastAnswerDate === todayStr, don't change streak (already counted today)

              transaction.update(userRef, {
                quizzesAnswered: currentAnswered,
                quizzesCorrect: currentCorrect,
                quizzesIncorrect: currentIncorrect,
                lastAnswerDate: todayStr,
                currentStreak,
                longestStreak,
              });
            }
          });

          // Mark poll as answered
          await db.collection("active_polls").doc(pollId).update({
            answered: true,
            userChoice,
            isCorrect,
            answeredAt: new Date(),
          });

          // Send feedback message to the user
          if (isCorrect) {
            await sendMessage(chatId, "🎉 <b>ถูกต้องนะครับ!</b> เก่งมากครับ 👏", "HTML");
          } else {
            await sendMessage(chatId, "❌ <b>ยังไม่ถูกนะครับ!</b> ลองทบทวนคำใบ้และเฉลยดูใหม่น้า ✌️", "HTML");
          }
        }
      }
      return Response.json({ ok: true });
    }

    const message = body?.message;

    if (!message?.text) {
      return Response.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const userRef = db.collection("users").doc(chatId);

    // ─── /start ────────────────────────────────────────
    if (text === "/start") {
      const doc = await userRef.get();
      if (!doc.exists) {
        await userRef.set({
          isAwake: true,
          currentSubject: "สุ่มทุกวิชา",
          createdAt: FieldValue.serverTimestamp(),
          quizzesSent: 0,
          quizzesAnswered: 0,
          quizzesCorrect: 0,
          quizzesIncorrect: 0,
          currentStreak: 0,
          longestStreak: 0,
          lastAnswerDate: null,
        });
      } else {
        await userRef.update({ isAwake: true });
      }

      const subjectList = Object.keys(syllabusMap)
        .map((s) => `• ${s}`)
        .join("\n");

      const welcome =
        `🚔 <b>ยินดีต้อนรับสู่ Police Quiz Bot!</b>\n\n` +
        `ระบบจะส่งข้อสอบให้คุณโดยอัตโนมัติตามเวลาที่กำหนด\n\n` +
        `📚 <b>วิชาที่เลือกได้:</b>\n${subjectList}\n\n` +
        `🔧 <b>คำสั่งที่ใช้ได้:</b>\n` +
        `/subject ชื่อวิชา - เปลี่ยนวิชาข้อสอบ\n` +
        `/settimer นาที - ตั้งเวลาส่งข้อสอบ (เช่น /settimer 30)\n` +
        `/vocab - รับคำศัพท์ Oxford 3000 ทันที (รีเซ็ตเวลา 1 ชม.)\n` +
        `/sleep - หยุดส่งข้อสอบชั่วคราว\n` +
        `/wake - เปิดรับข้อสอบอีกครั้ง\n` +
        `/help - ดูคู่มือคำสั่งทั้งหมด`;

      await sendMessage(chatId, welcome, "HTML");

      // Send a quiz immediately
      try {
        await sendIndividualQuiz(chatId, "สุ่มทุกวิชา", 0);
      } catch (err) {
        console.error("Instant quiz on /start failed:", err);
      }

      return Response.json({ ok: true });
    }

    // ─── /help ─────────────────────────────────────────
    if (text === "/help") {
      const subjectList = Object.keys(syllabusMap)
        .map((s) => `• ${s}`)
        .join("\n");

      const helpMessage =
        `ℹ️ <b>คู่มือการใช้งานบอท:</b>\n\n` +
        `📚 <b>รายชื่อวิชาเตรียมสอบนายสิบตำรวจ (อำนวยการ):</b>\n${subjectList}\n\n` +
        `🔧 <b>คำสั่งทั้งหมด:</b>\n` +
        `/start - ลงทะเบียนและเปิดรับข้อสอบ\n` +
        `/help - แสดงคู่มือแนะนำการใช้งานนี้\n` +
        `/subject [ชื่อวิชา] - เปลี่ยนวิชาที่ต้องการสอบเฉพาะเจาะจง\n` +
        `/settimer [นาที] - ตั้งระยะเวลาการส่งข้อสอบ\n` +
        `/vocab - รับคำศัพท์ Oxford 3000 ทันที (รีเซ็ตเวลา 1 ชม.)\n` +
        `/sleep - หยุดส่งข้อสอบชั่วคราว (โหมดพักผ่อน)\n` +
        `/wake - เริ่มส่งข้อสอบต่อ (ออกจากโหมดพัก)`;

      await sendMessage(chatId, helpMessage, "HTML");
      return Response.json({ ok: true });
    }

    // ─── /sleep ────────────────────────────────────────
    if (text === "/sleep") {
      await userRef.set({ isAwake: false }, { merge: true });
      await sendMessage(
        chatId,
        "😴 <b>โหมดพัก</b> - ระบบจะหยุดส่งข้อสอบชั่วคราว\nพิมพ์ /wake เพื่อเปิดรับอีกครั้ง",
        "HTML"
      );
      return Response.json({ ok: true });
    }

    // ─── /wake ─────────────────────────────────────────
    if (text === "/wake") {
      await userRef.set({ isAwake: true }, { merge: true });
      await sendMessage(
        chatId,
        "☀️ <b>ตื่นแล้ว!</b> - ระบบจะส่งข้อสอบให้คุณอีกครั้งตามเวลาที่ตั้งไว้",
        "HTML"
      );
      return Response.json({ ok: true });
    }

    // ─── /vocab ─────────────────────────────────────────
    if (text === "/vocab") {
      await sendMessage(chatId, "📖 <b>กำลังสุ่มคำศัพท์จาก Oxford 3000 ให้คุณ...</b>", "HTML");
      try {
        const success = await sendIndividualVocabulary(chatId);
        if (!success) {
          await sendMessage(chatId, "❌ เกิดข้อผิดพลาดในการดึงคำศัพท์ กรุณาลองใหม่อีกครั้ง", "HTML");
        }
      } catch (err) {
        console.error("Instant vocabulary failed:", err);
        await sendMessage(chatId, "❌ เกิดข้อผิดพลาดในการดึงคำศัพท์ กรุณาลองใหม่อีกครั้ง", "HTML");
      }
      return Response.json({ ok: true });
    }

    // ─── /subject [name] ──────────────────────────────
    if (text.startsWith("/subject")) {
      const parts = text.split(" ");
      const subjectName = parts.slice(1).join(" ").trim();

      if (!subjectName) {
        const list = Object.keys(syllabusMap)
          .map((s) => `• \`${s}\``)
          .join("\n");
        await sendMessage(
          chatId,
          `📚 *กรุณาระบุชื่อวิชา:*\n${list}\n\nตัวอย่าง: /subject คอมพิวเตอร์`
        );
        return Response.json({ ok: true });
      }

      if (!syllabusMap[subjectName]) {
        const list = Object.keys(syllabusMap)
          .map((s) => `• \`${s}\``)
          .join("\n");
        await sendMessage(
          chatId,
          `❌ ไม่พบวิชา "${subjectName}"\n\n📚 *วิชาที่เลือกได้:*\n${list}`
        );
        return Response.json({ ok: true });
      }

      await userRef.set({ currentSubject: subjectName }, { merge: true });
      await sendMessage(
        chatId,
        `✅ เปลี่ยนวิชาเป็น *${subjectName}* เรียบร้อยแล้ว\\!`
      );

      // Send a quiz immediately in the new subject
      try {
        const uDoc = await userRef.get();
        const uData = uDoc.data() || {};
        await sendIndividualQuiz(chatId, subjectName, uData.quizzesSent || 0);
      } catch (err) {
        console.error("Instant quiz on /subject failed:", err);
      }

      return Response.json({ ok: true });
    }

    // ─── /settimer [minutes] ──────────────────────────
    if (text.startsWith("/settimer")) {
      const parts = text.split(" ");
      const minutesStr = parts[1]?.trim();
      const minutes = parseInt(minutesStr, 10);

      if (isNaN(minutes) || minutes < 10 || minutes > 1440) {
        await sendMessage(
          chatId,
          "⏱️ *กรุณาระบุช่วงเวลาระหว่าง 10 ถึง 1440 นาที*\\!\n\nตัวอย่าง: `/settimer 30` \\(ส่งทุก 30 นาที\\)"
        );
        return Response.json({ ok: true });
      }

      await userRef.set({ quizInterval: minutes }, { merge: true });
      await sendMessage(
        chatId,
        `⏱️ *เปลี่ยนเวลาส่งข้อสอบเป็นทุกๆ ${minutes} นาที เรียบร้อยแล้วครับ\\!* \\(ระบบจะเริ่มรอบใหม่ทันที\\)`
      );

      // Send a quiz immediately to start the cycle
      try {
        const uDoc = await userRef.get();
        const uData = uDoc.data() || {};
        await sendIndividualQuiz(chatId, uData.currentSubject || "สุ่มทุกวิชา", uData.quizzesSent || 0);
      } catch (err) {
        console.error("Instant quiz on /settimer failed:", err);
      }

      return Response.json({ ok: true });
    }

    // ─── /stats ────────────────────────────────────────
    if (text === "/stats") {
      const doc = await userRef.get();
      if (!doc.exists) {
        await sendMessage(chatId, "❌ <b>ยังไม่พบข้อมูลผู้ใช้ในระบบ</b>", "HTML");
        return Response.json({ ok: true });
      }

      const uData = doc.data() || {};
      const answered = uData.quizzesAnswered || 0;
      const correct = uData.quizzesCorrect || 0;
      const incorrect = uData.quizzesIncorrect || 0;
      const sent = uData.quizzesSent || 0;
      const currentSubject = uData.currentSubject || "สุ่มทุกวิชา";
      const interval = uData.quizInterval || 60;
      
      const rate = answered > 0 ? ((correct / answered) * 100).toFixed(1) : "0.0";

      const streak = uData.currentStreak || 0;
      const longestStreak = uData.longestStreak || 0;

      // Exam countdown (29 พ.ย. 69 คือ Nov 29, 2026)
      const examDate = new Date("2026-11-29T00:00:00+07:00");
      const nowDate = new Date();
      const daysLeft = Math.max(0, Math.ceil((examDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24)));

      const statsMessage =
        `📊 <b>สถิติการเรียนรู้ของคุณ:</b>\n\n` +
        `📚 <b>วิชาปัจจุบัน:</b> ${currentSubject}\n` +
        `⏱️ <b>รอบส่งข้อสอบ:</b> ทุกๆ ${interval} นาที\n\n` +
        `📝 <b>ข้อสอบที่ส่งแล้ว:</b> ${sent} ข้อ\n` +
        `✅ <b>ทำแล้วตอบถูก:</b> ${correct} ข้อ\n` +
        `❌ <b>ทำแล้วตอบผิด:</b> ${incorrect} ข้อ\n` +
        `📈 <b>อัตราตอบถูก:</b> ${rate}%\n\n` +
        `🔥 <b>Streak:</b> ${streak} วันติดต่อกัน (สูงสุด ${longestStreak} วัน)\n` +
        `📅 <b>นับถอยหลังสอบ:</b> เหลืออีก ${daysLeft} วัน (สอบ 29 พ.ย. 69)\n\n` +
        `สู้ๆ นะครับ! ฝึกทำวันละนิดเพื่อเป้าหมายของคุณ 👮‍♂️✨`;

      await sendMessage(chatId, statsMessage, "HTML");
      return Response.json({ ok: true });
    }

    // Unknown command
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always return 200 to Telegram to prevent retries
    return Response.json({ ok: true });
  }
}
