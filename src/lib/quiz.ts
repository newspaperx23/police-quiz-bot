import { db } from "./firebase";
import { FieldValue } from "firebase-admin/firestore";
import { syllabusMap, getRandomSubject } from "./syllabus";
import { escapeMarkdownV2, sendMessage, sendQuizPoll } from "./telegram";
import OpenAI from "openai";

interface QuizQuestion {
  question: string;
  options: string[];
  correct_option_id: number;
  hint: string;
  explanation: string;
}

/**
 * Generates and sends a single quiz question to a specific user.
 * Reusable by both the scheduled batch job and manual commands (/start, /subject).
 */
export async function sendIndividualQuiz(
  chatId: string,
  currentSubject: string,
  quizzesSentBefore: number = 0
): Promise<boolean> {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Resolve subject
    let subject = currentSubject || "สุ่มทุกวิชา";
    if (subject === "สุ่มทุกวิชา") {
      subject = getRandomSubject();
    }

    const syllabus = syllabusMap[subject];
    if (!syllabus) {
      console.warn(`Unknown subject "${subject}" for user ${chatId}`);
      return false;
    }

    // Fetch last 10 questions from history to avoid duplicates
    let pastQuestionsText = "";
    try {
      const historySnapshot = await db
        .collection("quiz_history")
        .where("chatId", "==", chatId)
        .orderBy("sentAt", "desc")
        .limit(10)
        .get();
      if (!historySnapshot.empty) {
        const pastQuestions = historySnapshot.docs.map((doc) => doc.data().question);
        pastQuestionsText = `\nหลีกเลี่ยงการออกข้อสอบที่มีคำถาม ตัวเลข หรือโจทย์ซ้ำ/คล้ายคลึงกับคำถามเหล่านี้อย่างเด็ดขาด:\n${pastQuestions.map((q, idx) => `${idx + 1}. ${q}`).join("\n")}`;
      }
    } catch (err) {
      console.error("Failed to fetch quiz history for duplication check:", err);
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
- ห้ามถามซ้ำ ให้เปลี่ยนหัวข้อย่อยทุกครั้ง${pastQuestionsText}`;

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
      return false;
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
      return false;
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
    const pollId = await sendQuizPoll(
      chatId,
      quiz.question,
      quiz.options,
      quiz.correct_option_id,
      quiz.explanation
    );

    if (pollId) {
      // Register the active poll for tracking response stats
      await db.collection("active_polls").doc(pollId).set({
        chatId,
        correctOptionId: quiz.correct_option_id,
        sentAt: new Date(),
        answered: false,
      });
    }

    // ─── Update stats ─────────────────────────────
    const userRef = db.collection("users").doc(chatId);
    await userRef.update({
      quizzesSent: FieldValue.increment(1),
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
      pollId: pollId || null,
    });

    return true;
  } catch (error) {
    console.error(`sendIndividualQuiz error for user ${chatId}:`, error);
    return false;
  }
}
