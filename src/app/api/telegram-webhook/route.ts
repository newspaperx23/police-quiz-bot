import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { syllabusMap, SUBJECT_KEYS } from "@/lib/syllabus";
import { sendMessage } from "@/lib/telegram";
import { FieldValue } from "firebase-admin/firestore";
import { sendIndividualQuiz } from "@/lib/quiz";

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
      const pollId = pollAnswer.poll_id;
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

              transaction.update(userRef, {
                quizzesAnswered: currentAnswered,
                quizzesCorrect: currentCorrect,
                quizzesIncorrect: currentIncorrect,
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
            await sendMessage(chatId, "🎉 *ถูกต้องนะครับ\\!* เก่งมากครับ 👏");
          } else {
            await sendMessage(chatId, "❌ *ยังไม่ถูกนะครับ\\!* ลองทบทวนคำใบ้และเฉลยดูใหม่น้า ✌️");
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
        });
      } else {
        await userRef.update({ isAwake: true });
      }

      const subjectList = Object.keys(syllabusMap)
        .map((s) => `• ${s}`)
        .join("\n");

      const welcome =
        `🚔 *ยินดีต้อนรับสู่ Police Quiz Bot\\!*\n\n` +
        `ระบบจะส่งข้อสอบให้คุณโดยอัตโนมัติตามเวลาที่กำหนด\n\n` +
        `📚 *วิชาที่เลือกได้:*\n${subjectList}\n\n` +
        `🔧 *คำสั่ง:*\n` +
        `/subject ชื่อวิชา \\- เปลี่ยนวิชา\n` +
        `/settimer นาที \\- ตั้งเวลาส่งข้อสอบ \\(เช่น /settimer 30\\)\n` +
        `/sleep \\- หยุดส่งข้อสอบชั่วคราว\n` +
        `/wake \\- เปิดรับข้อสอบอีกครั้ง\n` +
        `/help \\- ดูคู่มือคำสั่งทั้งหมด`;

      await sendMessage(chatId, welcome);

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
        `ℹ️ *คู่มือการใช้งานบอท:*\n\n` +
        `📚 *รายชื่อวิชาเตรียมสอบนายสิบตำรวจ (อำนวยการ):*\n${subjectList}\n\n` +
        `🔧 *คำสั่งทั้งหมด:*\n` +
        `/start \\- ลงทะเบียนและเปิดรับข้อสอบ\n` +
        `/help \\- แสดงคู่มือแนะนำการใช้งานนี้\n` +
        `/subject \\[ชื่อวิชา\\] \\- เปลี่ยนวิชาที่ต้องการสอบเฉพาะเจาะจง\n` +
        `/settimer \\[นาที\\] \\- ตั้งระยะเวลาการส่งข้อสอบ\n` +
        `/sleep \\- หยุดส่งข้อสอบชั่วคราว (โหมดพักผ่อน)\n` +
        `/wake \\- เริ่มส่งข้อสอบต่อ (ออกจากโหมดพัก)`;

      await sendMessage(chatId, helpMessage);
      return Response.json({ ok: true });
    }

    // ─── /sleep ────────────────────────────────────────
    if (text === "/sleep") {
      await userRef.set({ isAwake: false }, { merge: true });
      await sendMessage(
        chatId,
        "😴 *โหมดพัก* \\- ระบบจะหยุดส่งข้อสอบชั่วคราว\nพิมพ์ /wake เพื่อเปิดรับอีกครั้ง"
      );
      return Response.json({ ok: true });
    }

    // ─── /wake ─────────────────────────────────────────
    if (text === "/wake") {
      await userRef.set({ isAwake: true }, { merge: true });
      await sendMessage(
        chatId,
        "☀️ *ตื่นแล้ว\\!* \\- ระบบจะส่งข้อสอบให้คุณอีกครั้งทุกชั่วโมง"
      );
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
        await sendMessage(chatId, "❌ *ยังไม่พบข้อมูลผู้ใช้ในระบบ*");
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

      const statsMessage =
        `📊 *สถิติการเรียนรู้ของคุณ:*\n\n` +
        `📚 *วิชาปัจจุบัน:* ${currentSubject}\n` +
        `⏱️ *รอบส่งข้อสอบ:* ทุกๆ ${interval} นาที\n\n` +
        `📝 *ข้อสอบที่ส่งแล้ว:* ${sent} ข้อ\n` +
        `✅ *ทำแล้วตอบถูก:* ${correct} ข้อ\n` +
        `❌ *ทำแล้วตอบผิด:* ${incorrect} ข้อ\n` +
        `📈 *อัตราตอบถูก:* ${rate}%\n\n` +
        `สู้ๆ นะครับ! ฝึกทำวันละนิดเพื่อเป้าหมายของคุุณ 👮‍♂️✨`;

      await sendMessage(chatId, statsMessage);
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
