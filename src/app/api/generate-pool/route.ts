import { db } from "@/lib/firebase";
import { syllabusMap, getRandomSubject } from "@/lib/syllabus";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/generate-pool
 * Generates a batch of 5 quiz questions for a specific subject and saves them to the global pool.
 */
export async function GET(request: Request) {
  try {
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

    // Generate questions in bulk via OpenAI
    const prompt = `คุณคืออาจารย์ผู้ออกข้อสอบคัดเลือกนายสิบตำรวจไทย (สายอำนวยการ)
วิชา: ${subject}
ขอบเขตเนื้อหา: ${syllabus}

ออกข้อสอบปรนัยจำนวน ${count} ข้อ (ข้อละ 4 ตัวเลือก) ในขอบเขตนี้ โดยห้ามถามเรื่องซ้ำกัน ต้องเปลี่ยนหัวข้อย่อยและเนื้อหาโจทย์ในแต่ละข้อ
แต่ละข้อต้องมี: คำถาม, ตัวเลือก 4 ข้อ, เฉลย (0-3), คำใบ้สั้นๆ 1 บรรทัด และคำอธิบายเฉลยอย่างละเอียด

ตอบกลับเป็นรูปแบบ JSON Object เท่านั้น มีโครงสร้างดังนี้:
{
  "quizzes": [
    {
      "question": "คำถามข้อที่ 1",
      "options": ["ก. ...", "ข. ...", "ค. ...", "ง. ..."],
      "correct_option_id": 0,
      "hint": "คำใบ้ข้อที่ 1",
      "explanation": "คำอธิบายเฉลยข้อที่ 1"
    },
    ...
  ]
}

กฎ:
- correct_option_id ต้องเป็น index ตัวเลข (0 ถึง 3) เท่านั้น
- ข้อสอบระดับยากปานกลาง เหมาะสำหรับการสอบคัดเลือกจริง`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.85,
      max_tokens: 2500,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("Empty response from OpenAI");
    }

    const data = JSON.parse(raw);
    const quizzes = data.quizzes || [];

    if (!Array.isArray(quizzes) || quizzes.length === 0) {
      throw new Error("No quizzes generated or invalid format");
    }

    let savedCount = 0;
    const batch = db.batch();

    for (const q of quizzes) {
      // Basic validation
      if (
        !q.question ||
        !q.options ||
        q.options.length !== 4 ||
        q.correct_option_id === undefined
      ) {
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
