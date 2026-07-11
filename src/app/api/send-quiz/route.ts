import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { syllabusMap, getRandomSubject } from "@/lib/syllabus";
import { escapeMarkdownV2, sendMessage, sendQuizPoll } from "@/lib/telegram";
import OpenAI from "openai";

export const dynamic = "force-dynamic";


interface QuizQuestion {
  question: string;
  options: string[];
  correct_option_id: number;
  hint: string;
  explanation: string;
}

/**
 * POST /api/send-quiz
 * Hourly quiz dispatcher. Secured by CRON_SECRET bearer token.
 *
 * 1. Query all awake users from Firestore
 * 2. Map each user's currentSubject → syllabusMap scope
 * 3. Call OpenAI (gpt-4o-mini) to generate a quiz question (JSON mode)
 * 4. Send hint via sendMessage (MarkdownV2 spoiler)
 * 5. Send quiz poll via sendPoll
 */
export async function POST(request: NextRequest) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ─── Auth check ────────────────────────────────────
    const authHeader = request.headers.get("authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader !== expectedToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ─── Fetch awake users ────────────────────────────
    const snapshot = await db
      .collection("users")
      .where("isAwake", "==", true)
      .get();

    if (snapshot.empty) {
      return Response.json({ message: "No awake users", sent: 0 });
    }

    let sentCount = 0;
    let errorCount = 0;

    // ─── Process each user ────────────────────────────
    for (const doc of snapshot.docs) {
      const chatId = doc.id;
      const userData = doc.data();

      try {
        // Resolve subject
        let subject = userData.currentSubject || "สุ่มทุกวิชา";
        if (subject === "สุ่มทุกวิชา") {
          subject = getRandomSubject();
        }

        const syllabus = syllabusMap[subject];
        if (!syllabus) {
          console.warn(`Unknown subject "${subject}" for user ${chatId}`);
          continue;
        }

        // ─── Generate question via OpenAI ──────────────
        const prompt = `คุณคืออาจารย์ผู้ออกข้อสอบคัดเลือกนายสิบตำรวจไทย (สายอำนวยการ)
วิชา: ${subject}
ขอบเขตเนื้อหา: ${syllabus}

ออกข้อสอบปรนัย 1 ข้อ (4 ตัวเลือก) พร้อมคำใบ้สั้นๆ และคำอธิบายเฉลย

ตอบเป็น JSON เท่านั้น:
{
  "question": "คำถาม",
  "options": ["ก. ...", "ข. ...", "ค. ...", "ง. ..."],
  "correct_option_id": 0,
  "hint": "คำใบ้สั้นๆ 1 บรรทัด",
  "explanation": "คำอธิบายเฉลยย่อ"
}

กฎ:
- correct_option_id เป็น index (0-3)
- ข้อสอบต้องเหมาะกับการสอบคัดเลือกจริง ระดับยากปานกลาง
- ห้ามถามซ้ำ ให้เปลี่ยนหัวข้อย่อยทุกครั้ง`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.9,
          max_tokens: 1000,
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
          console.error(`Empty OpenAI response for user ${chatId}`);
          errorCount++;
          continue;
        }

        const quiz: QuizQuestion = JSON.parse(raw);

        // Validate
        if (
          !quiz.question ||
          !quiz.options ||
          quiz.options.length !== 4 ||
          quiz.correct_option_id === undefined
        ) {
          console.error(`Invalid quiz structure for user ${chatId}:`, raw);
          errorCount++;
          continue;
        }

        // ─── Send hint message (MarkdownV2 spoiler) ────
        const escapedHint = escapeMarkdownV2(quiz.hint || "ไม่มีคำใบ้");
        const hintMessage =
          `📝 *${escapeMarkdownV2(subject)}*\n\n` +
          `💡 คำใบ้: ||${escapedHint}||`;

        await sendMessage(chatId, hintMessage);

        // Small delay between messages
        await new Promise((r) => setTimeout(r, 300));

        // ─── Send quiz poll ───────────────────────────
        await sendQuizPoll(
          chatId,
          quiz.question,
          quiz.options,
          quiz.correct_option_id,
          quiz.explanation
        );

        // ─── Update stats ─────────────────────────────
        const userRef = db.collection("users").doc(chatId);
        await userRef.update({
          quizzesSent: (userData.quizzesSent || 0) + 1,
          lastQuizAt: new Date(),
          lastSubject: subject,
        });

        // ─── Log quiz to history ───────────────────────
        await db.collection("quiz_history").add({
          chatId,
          subject,
          question: quiz.question,
          correctAnswer: quiz.options[quiz.correct_option_id],
          sentAt: new Date(),
        });

        sentCount++;
      } catch (userError) {
        console.error(`Error processing user ${chatId}:`, userError);
        errorCount++;
      }
    }

    return Response.json({
      message: "Quiz dispatch complete",
      sent: sentCount,
      errors: errorCount,
      total: snapshot.size,
    });
  } catch (error) {
    console.error("Send quiz error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
