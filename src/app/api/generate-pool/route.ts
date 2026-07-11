import { db } from "@/lib/firebase";
import { syllabusMap, getRandomSubject } from "@/lib/syllabus";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

interface GeneratedQuiz {
  question: string;
  options: string[];
  correct_option_id: number;
  correct_answer_text: string;
  hint: string;
  explanation: string;
}

/**
 * Verifies a single quiz question by asking GPT to independently solve it.
 * Returns the verified correct_option_id, or -1 if verification fails.
 */
async function verifyQuizAnswer(
  openai: OpenAI,
  quiz: GeneratedQuiz
): Promise<number> {
  const verifyPrompt = `คุณเป็นผู้ตรวจสอบข้อสอบ กรุณาตรวจสอบข้อสอบต่อไปนี้และระบุคำตอบที่ถูกต้อง

คำถาม: ${quiz.question}

ตัวเลือก:
${quiz.options.map((opt, idx) => `${idx}. ${opt}`).join("\n")}

กรุณาตอบกลับเป็น JSON Object เท่านั้น ในรูปแบบ:
{
  "correct_option_id": <ตัวเลข 0-3 ที่เป็นคำตอบที่ถูกต้อง>,
  "reasoning": "เหตุผลสั้นๆ ว่าทำไมจึงเลือกข้อนี้"
}

กฎ:
- ตอบตามความรู้ที่ถูกต้องเท่านั้น อย่าเดา
- correct_option_id เป็น index (0-3) เท่านั้น`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: verifyPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.1, // Low temperature for deterministic verification
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return -1;

    const result = JSON.parse(raw);
    return typeof result.correct_option_id === "number" ? result.correct_option_id : -1;
  } catch {
    return -1;
  }
}

/**
 * GET/POST /api/generate-pool
 * Generates a batch of quiz questions for a specific subject and saves them to the global pool.
 * Includes strict answer verification to prevent incorrect answers.
 */
export async function GET(request: Request) {
  try {
    // Auth Check
    const authHeader = request.headers.get("authorization");
    if (!authHeader || authHeader !== "Bearer !159951zZ") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subjectParam = searchParams.get("subject");
    const countParam = parseInt(searchParams.get("count") || "5", 10);

    // Limit count to prevent serverless function timeout (max 10)
    const count = Math.min(Math.max(countParam, 1), 10);

    // Resolve subject
    let subject = subjectParam || "";
    if (!subject || !syllabusMap[subject] || subject === "สุ่มทุกวิชา") {
      subject = getRandomSubject();
    }

    const syllabus = syllabusMap[subject];
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Fetch existing questions in the pool for this subject to prevent duplicates
    let pastQuestionsText = "";
    try {
      const existingSnapshot = await db
        .collection("global_quizzes")
        .where("subject", "==", subject)
        .limit(50)
        .get();
      if (!existingSnapshot.empty) {
        const pastQuestions = existingSnapshot.docs.map((doc) => doc.data().question);
        pastQuestionsText = `\nห้ามออกข้อสอบที่มีคำถามหรือเนื้อความซ้ำหรือใกล้เคียงกับข้อสอบเก่าเหล่านี้เด็ดขาด:\n${pastQuestions.map((q, idx) => `${idx + 1}. ${q}`).join("\n")}`;
      }
    } catch (err) {
      console.error("Failed to fetch existing global_quizzes:", err);
    }

    // Generate questions in bulk via OpenAI with STRICT answer verification instructions
    const prompt = `คุณคืออาจารย์ผู้ออกข้อสอบคัดเลือกนายสิบตำรวจไทย (สายอำนวยการ)
วิชา: ${subject}
ขอบเขตเนื้อหา: ${syllabus}

ออกข้อสอบปรนัยจำนวน ${count} ข้อ (ข้อละ 4 ตัวเลือก) ในขอบเขตนี้ โดยห้ามถามเรื่องซ้ำกัน ต้องเปลี่ยนหัวข้อย่อยและเนื้อหาโจทย์ในแต่ละข้อ

ตอบกลับเป็นรูปแบบ JSON Object เท่านั้น มีโครงสร้างดังนี้:
{
  "quizzes": [
    {
      "question": "คำถามข้อที่ 1",
      "options": ["ก. ...", "ข. ...", "ค. ...", "ง. ..."],
      "correct_option_id": 0,
      "correct_answer_text": "ก. ... (ข้อความเต็มของตัวเลือกที่ถูกต้อง ต้องตรงกับ options[correct_option_id] เป๊ะ)",
      "hint": "คำใบ้ข้อที่ 1",
      "explanation": "คำอธิบายเฉลยข้อที่ 1 ระบุเหตุผลว่าทำไมตัวเลือกนี้จึงถูก และทำไมตัวเลือกอื่นจึงผิด"
    },
    ...
  ]
}

กฎสำคัญมาก (ต้องปฏิบัติทุกข้อ):
1. correct_option_id ต้องเป็น index ตัวเลข (0 ถึง 3) ที่ตรงกับตัวเลือกที่ถูกต้องจริงๆ
2. correct_answer_text ต้องเป็นข้อความที่คัดลอกมาจาก options[correct_option_id] ตรงตัว ต้องตรงกันทุกตัวอักษร
3. explanation ต้องอธิบายชัดเจนว่าทำไมคำตอบนั้นจึงถูก
4. ก่อนตอบ ให้ตรวจสอบซ้ำทุกข้อว่า correct_option_id ชี้ไปที่ตัวเลือกที่ถูกต้องจริง
5. ข้อสอบระดับยากปานกลาง เหมาะสำหรับการสอบคัดเลือกจริง
6. ห้ามออกข้อที่คำตอบคลุมเครือ ต้องมีคำตอบที่ถูกต้องชัดเจนเพียง 1 ข้อ${pastQuestionsText}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7, // Lowered from 0.85 for more accurate answers
      max_tokens: 3500,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("Empty response from OpenAI");
    }

    const data = JSON.parse(raw);
    const quizzes: GeneratedQuiz[] = data.quizzes || [];

    if (!Array.isArray(quizzes) || quizzes.length === 0) {
      throw new Error("No quizzes generated or invalid format");
    }

    let savedCount = 0;
    let skippedCount = 0;
    const batch = db.batch();

    for (const q of quizzes) {
      // ─── Phase 1: Basic structural validation ────────
      if (
        !q.question ||
        !q.options ||
        q.options.length !== 4 ||
        q.correct_option_id === undefined ||
        typeof q.correct_option_id !== "number" ||
        q.correct_option_id < 0 ||
        q.correct_option_id > 3
      ) {
        console.warn(`Skipping quiz with invalid structure: ${q.question?.slice(0, 50)}`);
        skippedCount++;
        continue;
      }

      // ─── Phase 2: Cross-check correct_answer_text against options ────
      if (q.correct_answer_text) {
        const expectedText = q.options[q.correct_option_id];
        if (expectedText && q.correct_answer_text.trim() !== expectedText.trim()) {
          // The model says the correct answer text doesn't match the index!
          // Try to find which option actually matches the correct_answer_text
          const matchIdx = q.options.findIndex(
            (opt) => opt.trim() === q.correct_answer_text.trim()
          );
          if (matchIdx >= 0 && matchIdx !== q.correct_option_id) {
            console.warn(
              `Quiz answer mismatch detected! Question: "${q.question.slice(0, 50)}" ` +
              `Index said ${q.correct_option_id} but text matches index ${matchIdx}. Auto-correcting.`
            );
            q.correct_option_id = matchIdx;
          }
        }
      }

      // ─── Phase 3: Independent verification via GPT ────
      const verifiedId = await verifyQuizAnswer(openai, q);
      if (verifiedId >= 0 && verifiedId !== q.correct_option_id) {
        console.warn(
          `Verification mismatch for: "${q.question.slice(0, 60)}" — ` +
          `Original: ${q.correct_option_id}, Verified: ${verifiedId}. Using verified answer.`
        );
        q.correct_option_id = verifiedId;
      } else if (verifiedId < 0) {
        console.warn(
          `Could not verify quiz: "${q.question.slice(0, 60)}" — skipping to be safe.`
        );
        skippedCount++;
        continue;
      }

      const docRef = db.collection("global_quizzes").doc();
      batch.set(docRef, {
        subject,
        question: q.question,
        options: q.options,
        correct_option_id: q.correct_option_id,
        hint: q.hint || "ไม่มีคำใบ้",
        explanation: q.explanation || "ไม่มีคำอธิบายเพิ่มเติม",
        verified: true,
        createdAt: new Date(),
      });
      savedCount++;
    }

    if (savedCount > 0) {
      await batch.commit();
    }

    return Response.json({
      success: true,
      subject,
      requestedCount: count,
      savedCount,
      skippedCount,
    });
  } catch (error) {
    console.error("Generate pool API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to generate quiz pool" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
