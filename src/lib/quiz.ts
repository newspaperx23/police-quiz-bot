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
 * Verifies a quiz answer by independently asking GPT to solve it.
 * Returns the verified correct_option_id, or -1 if verification fails.
 */
async function verifyQuizAnswer(
  openai: OpenAI,
  quiz: QuizQuestion
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
      temperature: 0.1,
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

    // ─── Try Spaced Repetition First (20% chance) ─────
    let quiz: QuizQuestion | null = null;
    let quizId: string | null = null;
    let isFromPool = false;
    let isReview = false;

    const userRef = db.collection("users").doc(chatId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const answeredQuizIds: string[] = userData?.answeredQuizIds || [];

    const incorrectQuizzesRef = db.collection("users").doc(chatId).collection("incorrect_quizzes");
    
    if (Math.random() < 0.20) {
      try {
        const incorrectSnapshot = await incorrectQuizzesRef.limit(10).get();
        if (!incorrectSnapshot.empty) {
          // Pick a random incorrect quiz
          const selectedIncorrect = incorrectSnapshot.docs[Math.floor(Math.random() * incorrectSnapshot.size)];
          const incorrectData = selectedIncorrect.data();
          const targetQuizId = incorrectData.quizId;
          
          if (targetQuizId) {
            const globalDoc = await db.collection("global_quizzes").doc(targetQuizId).get();
            if (globalDoc.exists) {
              const data = globalDoc.data();
              if (data) {
                quiz = {
                  question: data.question,
                  options: data.options,
                  correct_option_id: data.correct_option_id,
                  hint: data.hint,
                  explanation: data.explanation,
                };
                quizId = targetQuizId;
                isFromPool = true;
                isReview = true;
                console.log(`[Spaced Repetition] Selected quiz ${quizId} for user ${chatId}`);
              }
            } else {
              // Delete stale review ref
              await selectedIncorrect.ref.delete();
            }
          }
        }
      } catch (spacedErr) {
        console.error("Spaced repetition query failed, falling back to normal:", spacedErr);
      }
    }

    // ─── Try to get from global_quizzes pool if not review ────
    if (!quiz) {
      try {
        // Pool Exhaustion Fix: Use select() to fetch only IDs and scale properly
        const poolSnapshot = await db
          .collection("global_quizzes")
          .where("subject", "==", subject)
          .select()
          .get();

        if (!poolSnapshot.empty) {
          const unusedQuizzes = poolSnapshot.docs.filter(
            (doc) => !answeredQuizIds.includes(doc.id)
          );

          if (unusedQuizzes.length > 0) {
            const selectedDoc = unusedQuizzes[Math.floor(Math.random() * unusedQuizzes.length)];
            const fullDoc = await selectedDoc.ref.get();
            const data = fullDoc.data();
            if (data) {
              const candidateQuiz: QuizQuestion = {
                question: data.question,
                options: data.options,
                correct_option_id: data.correct_option_id,
                hint: data.hint,
                explanation: data.explanation,
              };

              // ─── Verify pool quiz answer (same as realtime gen) ─
              try {
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const verifiedId = await verifyQuizAnswer(openai, candidateQuiz);
                if (verifiedId >= 0 && verifiedId !== candidateQuiz.correct_option_id) {
                  console.warn(
                    `[Pool Verify] Quiz ${selectedDoc.id} had wrong answer: ` +
                    `stored=${candidateQuiz.correct_option_id}, verified=${verifiedId}. Auto-fixing...`
                  );
                  // Auto-fix in Firestore so it won't be wrong again
                  await selectedDoc.ref.update({ correct_option_id: verifiedId });
                  candidateQuiz.correct_option_id = verifiedId;
                }
              } catch (verifyErr) {
                console.error(`[Pool Verify] Failed to verify quiz ${selectedDoc.id}:`, verifyErr);
                // Proceed with stored value if verification fails
              }

              quiz = candidateQuiz;
              quizId = selectedDoc.id;
              isFromPool = true;
              console.log(`Successfully retrieved quiz ${quizId} from global_quizzes pool for user ${chatId}`);
            }
          }
        }
      } catch (poolErr) {
        console.error("Error fetching quiz from global pool:", poolErr);
      }
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

      // Generate question via OpenAI with strict answer verification and 3 retries
      const prompt = `คุณคืออาจารย์ผู้ออกข้อสอบคัดเลือกนายสิบตำรวจไทย (สายอำนวยการ)
วิชา: ${subject}
ขอบเขตเนื้อหา: ${syllabus}

ออกข้อสอบปรนัย 1 ข้อ (4 ตัวเลือก) พร้อมคำใบ้สั้นๆ และคำอธิบายเฉลย

ตอบเป็น JSON เท่านั้น:
{
  "question": "คำถาม",
  "options": ["ก. ...", "ข. ...", "ค. ...", "ง. ..."],
  "correct_option_id": 0,
  "correct_answer_text": "ก. ... (ข้อความเต็มของตัวเลือกที่ถูกต้อง ต้องตรงกับ options[correct_option_id])",
  "hint": "คำใบ้สั้นๆ 1 บรรทัด",
  "explanation": "คำอธิบายเฉลยอย่างละเอียด ระบุว่าทำไมจึงเลือกข้อนี้"
}

กฎสำคัญ:
- correct_option_id เป็น index (0-3) ที่ตรงกับตัวเลือกที่ถูกต้องจริง
- correct_answer_text ต้องคัดลอกจาก options[correct_option_id] ตรงตัว
- ข้อสอบต้องเหมาะกับการสอบคัดเลือกจริง ระดับยากปานกลาง
- ห้ามออกข้อที่คำตอบคลุมเครือ ต้องมีคำตอบที่ถูกต้องชัดเจน 1 ข้อ
- ก่อนตอบ ให้ตรวจสอบซ้ำว่า correct_option_id ชี้ไปที่คำตอบที่ถูกจริง
- ห้ามถามซ้ำ ให้เปลี่ยนหัวข้อย่อยทุกครั้ง${pastQuestionsText}`;

      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 1000,
          });

          const raw = completion.choices[0]?.message?.content;
          if (!raw) {
            console.error(`Empty OpenAI response for user ${chatId} (attempt ${attempts})`);
            continue;
          }

          const parsedQuiz = JSON.parse(raw);

          // Validate structure
          if (
            !parsedQuiz.question ||
            !parsedQuiz.options ||
            parsedQuiz.options.length !== 4 ||
            parsedQuiz.correct_option_id === undefined ||
            typeof parsedQuiz.correct_option_id !== "number" ||
            parsedQuiz.correct_option_id < 0 ||
            parsedQuiz.correct_option_id > 3
          ) {
            console.error(`Invalid quiz structure (attempt ${attempts}):`, raw);
            continue;
          }

          // Cross-check correct_answer_text
          if (parsedQuiz.correct_answer_text) {
            const expectedText = parsedQuiz.options[parsedQuiz.correct_option_id];
            if (expectedText && parsedQuiz.correct_answer_text.trim() !== expectedText.trim()) {
              const matchIdx = parsedQuiz.options.findIndex(
                (opt: string) => opt.trim() === parsedQuiz.correct_answer_text.trim()
              );
              if (matchIdx >= 0 && matchIdx !== parsedQuiz.correct_option_id) {
                parsedQuiz.correct_option_id = matchIdx;
              }
            }
          }

          // Independent verification
          const verifiedId = await verifyQuizAnswer(openai, parsedQuiz);
          if (verifiedId < 0) {
            console.warn(`Verification failed for realtime quiz (attempt ${attempts})`);
            continue; // retry
          }

          if (verifiedId !== parsedQuiz.correct_option_id) {
            console.warn(
              `Verification override for realtime quiz: "${parsedQuiz.question.slice(0, 50)}" ` +
              `Original: ${parsedQuiz.correct_option_id}, Verified: ${verifiedId}`
            );
            parsedQuiz.correct_option_id = verifiedId;
          }

          quiz = {
            question: parsedQuiz.question,
            options: parsedQuiz.options,
            correct_option_id: parsedQuiz.correct_option_id,
            hint: parsedQuiz.hint || "ไม่มีคำใบ้",
            explanation: parsedQuiz.explanation || "ไม่มีคำอธิบายเพิ่มเติม",
          };
          break; // success
        } catch (err) {
          console.error(`Error in OpenAI generation attempt ${attempts}:`, err);
        }
      }

      if (!quiz) {
        console.error(`Failed to generate verified quiz after ${maxAttempts} attempts`);
        return false;
      }

      // Save this newly generated quiz to the global pool so other users can reuse it!
      try {
        const newDocRef = await db.collection("global_quizzes").add({
          subject,
          question: quiz.question,
          options: quiz.options,
          correct_option_id: quiz.correct_option_id,
          hint: quiz.hint || "ไม่มีคำใบ้",
          explanation: quiz.explanation || "ไม่มีคำอธิบายเพิ่มเติม",
          verified: true,
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
    let hintMessage = "";
    if (isReview) {
      hintMessage += `🔄 *\\[ทบทวนข้อที่เคยทำผิด\\]*\n\n`;
    }
    hintMessage += `📝 *${escapeMarkdownV2(subject)}*\n\n` +
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
        options: quiz.options,
        explanation: quiz.explanation || "",
        sentAt: new Date(),
        answered: false,
        quizId: quizId || null,
        subject,
        isReview: isReview,
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
