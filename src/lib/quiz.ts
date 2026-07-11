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

    // ─── Try to get from global_quizzes pool first ────
    let quiz: QuizQuestion | null = null;
    let quizId: string | null = null;
    let isFromPool = false;

    const userRef = db.collection("users").doc(chatId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const answeredQuizIds: string[] = userData?.answeredQuizIds || [];

    try {
      const poolSnapshot = await db
        .collection("global_quizzes")
        .where("subject", "==", subject)
        .limit(100)
        .get();

      if (!poolSnapshot.empty) {
        const unusedQuizzes = poolSnapshot.docs.filter(
          (doc) => !answeredQuizIds.includes(doc.id)
        );

        if (unusedQuizzes.length > 0) {
          // Pick a random quiz from the unused ones
          const selectedDoc = unusedQuizzes[Math.floor(Math.random() * unusedQuizzes.length)];
          const data = selectedDoc.data();
          quiz = {
            question: data.question,
            options: data.options,
            correct_option_id: data.correct_option_id,
            hint: data.hint,
            explanation: data.explanation,
          };
          quizId = selectedDoc.id;
          isFromPool = true;
          console.log(`Successfully retrieved quiz ${quizId} from global_quizzes pool for user ${chatId}`);
        }
      }
    } catch (poolErr) {
      console.error("Error fetching quiz from global pool:", poolErr);
    }

    // ─── Fallback to OpenAI generator ────────────────
    if (!quiz) {
      console.log(`No unused quizzes in pool for subject "${subject}" (or pool empty). Generating via OpenAI for user ${chatId}...`);
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

      // Generate question via OpenAI
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

      const parsedQuiz: QuizQuestion = JSON.parse(raw);

      // Validate
      if (
        !parsedQuiz.question ||
        !parsedQuiz.options ||
        parsedQuiz.options.length !== 4 ||
        parsedQuiz.correct_option_id === undefined
      ) {
        console.error(`Invalid quiz structure for user ${chatId}:`, raw);
        return false;
      }

      quiz = parsedQuiz;

      // Save this newly generated quiz to the global pool so other users can reuse it!
      try {
        const newDocRef = await db.collection("global_quizzes").add({
          subject,
          question: quiz.question,
          options: quiz.options,
          correct_option_id: quiz.correct_option_id,
          hint: quiz.hint || "ไม่มีคำใบ้",
          explanation: quiz.explanation || "ไม่มีคำอธิบายเพิ่มเติม",
          createdAt: new Date(),
        });
        quizId = newDocRef.id;
        console.log(`Saved newly generated quiz ${quizId} to global_quizzes pool.`);
      } catch (saveErr) {
        console.error("Failed to auto-populate new quiz to global pool:", saveErr);
      }
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

    // ─── Update stats & answeredQuizIds ───────────
    const updateData: any = {
      quizzesSent: FieldValue.increment(1),
      lastQuizAt: new Date(),
      lastSubject: subject,
    };
    if (quizId) {
      updateData.answeredQuizIds = FieldValue.arrayUnion(quizId);
    }
    await userRef.update(updateData);

    // ─── Log quiz to history ───────────────────────
    await db.collection("quiz_history").add({
      chatId,
      subject,
      question: quiz.question,
      correctAnswer: quiz.options[quiz.correct_option_id],
      sentAt: new Date(),
      pollId: pollId || null,
      quizId: quizId || null,
    });

    return true;
  } catch (error) {
    console.error(`sendIndividualQuiz error for user ${chatId}:`, error);
    return false;
  }
}
