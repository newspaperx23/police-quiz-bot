import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { syllabusMap, SUBJECT_KEYS } from "@/lib/syllabus";
import { sendMessage } from "@/lib/telegram";
import { FieldValue } from "firebase-admin/firestore";

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
        `ระบบจะส่งข้อสอบให้คุณทุกชั่วโมงโดยอัตโนมัติ\n\n` +
        `📚 *วิชาที่เลือกได้:*\n${subjectList}\n\n` +
        `🔧 *คำสั่ง:*\n` +
        `/subject ชื่อวิชา \\- เปลี่ยนวิชา\n` +
        `/sleep \\- หยุดส่งข้อสอบชั่วคราว\n` +
        `/wake \\- เปิดรับข้อสอบอีกครั้ง`;

      await sendMessage(chatId, welcome);
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
