"use client";

import { useEffect, useState, useCallback } from "react";

interface StatsData {
  totalUsers: number;
  awakeUsers: number;
  sleepingUsers: number;
  totalQuizzesSent: number;
  totalQuizzesAnswered?: number;
  totalQuizzesCorrect?: number;
  totalQuizzesIncorrect?: number;
  subjectCounts: Record<string, number>;
  recentQuizzes: {
    id: string;
    chatId: string;
    subject: string;
    question: string;
    correctAnswer: string;
    sentAt: string | null;
  }[];
  dailyCounts: Record<string, number>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ─── Helpers ──────────────────────────
  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("th-TH", { weekday: "short" });
  };

  // ─── Loading State ────────────────────
  if (loading && !stats) {
    return (
      <>
        <Navbar />
        <main className="container">
          <div className="loading-wrapper">
            <div className="loading-spinner" />
            <p className="loading-text">กำลังโหลดข้อมูล...</p>
          </div>
        </main>
      </>
    );
  }

  // ─── Error State ──────────────────────
  if (error && !stats) {
    return (
      <>
        <Navbar />
        <main className="container">
          <div className="error-wrapper">
            <div className="error-icon">⚠️</div>
            <h2 className="error-title">ไม่สามารถโหลดข้อมูลได้</h2>
            <p className="error-message">{error}</p>
            <button className="btn-retry" onClick={fetchStats}>
              ลองใหม่อีกครั้ง
            </button>
          </div>
        </main>
      </>
    );
  }

  if (!stats) return null;

  // ─── Chart data ───────────────────────
  const dailyEntries = Object.entries(stats.dailyCounts);
  const maxDaily = Math.max(...Object.values(stats.dailyCounts), 1);

  const subjectEntries = Object.entries(stats.subjectCounts).sort(
    (a, b) => b[1] - a[1]
  );
  const maxSubject = Math.max(...subjectEntries.map((e) => e[1]), 1);

  const answered = stats.totalQuizzesAnswered || 0;
  const correct = stats.totalQuizzesCorrect || 0;
  const incorrect = stats.totalQuizzesIncorrect || 0;
  const correctRate = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  return (
    <>
      <Navbar />

      <main className="container">
        {/* ─── Hero ───────────────────────────── */}
        <section className="hero">
          <div className="hero__badge">
            <span className="hero__badge-icon">🚔</span>
            ระบบเตรียมสอบนายสิบตำรวจ สายอำนวยการ
          </div>
          <h1 className="hero__title">
            <span className="hero__title-highlight">Police Quiz Bot</span>
          </h1>
          <p className="hero__description">
            ระบบส่งข้อสอบอัตโนมัติผ่าน Telegram Bot พร้อม AI
            ออกข้อสอบตามหลักสูตรจริง ครบทุกวิชา ทุกชั่วโมง
          </p>
        </section>

        {/* ─── Stats Cards ────────────────────── */}
        <section className="stats-grid" id="stats-overview">
          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--users">👥</div>
            <div className="stat-card__label">ผู้ใช้ทั้งหมด</div>
            <div className="stat-card__value stat-card__value--info">
              {stats.totalUsers}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--active">✅</div>
            <div className="stat-card__label">กำลังใช้งาน</div>
            <div className="stat-card__value stat-card__value--success">
              {stats.awakeUsers}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--sleep">😴</div>
            <div className="stat-card__label">โหมดพัก</div>
            <div className="stat-card__value stat-card__value--warning">
              {stats.sleepingUsers}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon stat-card__icon--quiz">📝</div>
            <div className="stat-card__label">ข้อสอบที่ส่งแล้ว</div>
            <div className="stat-card__value stat-card__value--purple">
              {stats.totalQuizzesSent}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e", border: "1px solid rgba(34, 197, 94, 0.2)" }}>🎯</div>
            <div className="stat-card__label">ทำแล้ว (ถูก / ผิด)</div>
            <div className="stat-card__value" style={{ color: "#ffffff", fontSize: "28px" }}>
              {answered} <span style={{ fontSize: "16px", color: "var(--text-muted)", fontWeight: "normal" }}>({correct} / {incorrect})</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.2)" }}>📈</div>
            <div className="stat-card__label">อัตราทำถูกเฉลี่ย</div>
            <div className="stat-card__value" style={{ color: "var(--warning)" }}>
              {correctRate}%
            </div>
          </div>
        </section>

        {/* ─── Charts Row ────────────────────── */}
        <section className="dashboard-grid" id="charts">
          {/* Daily Quiz Volume */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">📊 จำนวนข้อสอบ 7 วันย้อนหลัง</h2>
            </div>
            <div className="card__body">
              {dailyEntries.length > 0 ? (
                <div className="bar-chart">
                  {dailyEntries.map(([date, count]) => (
                    <div className="bar-chart__col" key={date}>
                      <span className="bar-chart__value">{count}</span>
                      <div
                        className="bar-chart__bar"
                        style={{
                          height: `${Math.max((count / maxDaily) * 100, 3)}%`,
                        }}
                      />
                      <span className="bar-chart__label">
                        {formatDay(date)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon">📭</div>
                  <p className="empty-state__text">ยังไม่มีข้อมูล</p>
                </div>
              )}
            </div>
          </div>

          {/* Subject Distribution */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">📚 การกระจายตัวของวิชา</h2>
            </div>
            <div className="card__body">
              {subjectEntries.length > 0 ? (
                <div className="subject-list">
                  {subjectEntries.map(([subject, count]) => (
                    <div className="subject-item" key={subject}>
                      <span className="subject-item__name">{subject}</span>
                      <div className="subject-item__bar-wrapper">
                        <div
                          className="subject-item__bar"
                          style={{
                            width: `${Math.max(
                              (count / maxSubject) * 100,
                              2
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="subject-item__count">{count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon">📭</div>
                  <p className="empty-state__text">ยังไม่มีข้อมูล</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Recent Quizzes ────────────────── */}
        <section className="recent-section" id="recent-quizzes">
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">🕐 ข้อสอบล่าสุด</h2>
            </div>
            <div className="card__body">
              {stats.recentQuizzes.length > 0 ? (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>เวลา</th>
                        <th>วิชา</th>
                        <th>คำถาม</th>
                        <th>เฉลย</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentQuizzes.map((quiz) => (
                        <tr key={quiz.id}>
                          <td>
                            <span className="time-text">
                              {formatDate(quiz.sentAt)}
                            </span>
                          </td>
                          <td>
                            <span className="tag">{quiz.subject}</span>
                          </td>
                          <td>
                            <span className="question-text">
                              {quiz.question}
                            </span>
                          </td>
                          <td>{quiz.correctAnswer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon">📭</div>
                  <p className="empty-state__text">
                    ยังไม่มีข้อสอบที่ส่ง — เมื่อ Cron ทำงาน ข้อมูลจะปรากฏที่นี่
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Features ──────────────────────── */}
        <section className="features-grid" id="features">
          <div className="feature-card">
            <div className="feature-card__icon">🤖</div>
            <h3 className="feature-card__title">AI ออกข้อสอบ</h3>
            <p className="feature-card__desc">
              ใช้ OpenAI GPT-4o-mini ออกข้อสอบใหม่ทุกครั้ง
              ไม่มีซ้ำ ตรงหลักสูตรจริง
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-card__icon">⏰</div>
            <h3 className="feature-card__title">ส่งทุกชั่วโมง</h3>
            <p className="feature-card__desc">
              GitHub Actions ทริกเกอร์ทุกชั่วโมง ส่งข้อสอบอัตโนมัติ
              ไม่ต้องเปิดแอป
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-card__icon">📱</div>
            <h3 className="feature-card__title">ตอบผ่าน Telegram</h3>
            <p className="feature-card__desc">
              รับข้อสอบแบบ Quiz Poll พร้อมคำใบ้และเฉลยอัตโนมัติ
              สะดวกทุกที่
            </p>
          </div>
        </section>
      </main>

      {/* ─── Footer ──────────────────────── */}
      <footer className="footer">
        <div className="container">
          <p className="footer__text">
            © 2026 Police Quiz Bot — ระบบเตรียมสอบนายสิบตำรวจ สายอำนวยการ
          </p>
        </div>
      </footer>
    </>
  );
}

/* ═══════════════════════════════════════
   Navbar Component (inline)
   ═══════════════════════════════════════ */

function Navbar() {
  return (
    <nav className="navbar">
      <div className="container navbar__inner">
        <a href="/" className="navbar__brand">
          <div className="navbar__logo">Q</div>
          <div>
            <div className="navbar__title">Police Quiz Bot</div>
            <div className="navbar__subtitle">Dashboard</div>
          </div>
        </a>
        <div className="navbar__actions">
          <div className="navbar__status">
            <span className="navbar__status-dot" />
            System Online
          </div>
        </div>
      </div>
    </nav>
  );
}
