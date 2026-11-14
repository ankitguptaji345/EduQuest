// @vitest-environment node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let baseUrl = '';
let server: http.Server;

// Imported dynamically after env vars are configured
let initDatabase: typeof import('../server/core/database.ts').initDatabase;
let setTestDb: typeof import('../server/core/database.ts').setTestDb;
let getDb: typeof import('../server/core/database.ts').getDb;
let jobWorker: typeof import('../server/core/jobQueue.ts').jobWorker;
let xpThresholdForLevel: typeof import('../server/services/progress/xpService.ts').xpThresholdForLevel;

async function reqJson<T = Record<string, unknown>>(
  urlPath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T;
  return { status: res.status, data };
}

async function waitForDocReady(docId: string, token: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    await jobWorker.tick();
    const res = await reqJson<{ document_status: string }>(`/api/documents/${docId}/job`, { token });
    if (res.data.document_status === 'ready' || res.data.document_status === 'failed') {
      return res.data.document_status;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return 'timeout';
}

describe('EduQuest AI Backend E2E Integration', () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduquest-test-'));
    process.env.NODE_ENV = 'test';
    process.env.AI_PROVIDER_MODE = 'rule_based';
    process.env.OCR_ENABLED = 'false';
    process.env.LOCAL_STORAGE_DIR = path.join(tmpDir, 'storage');
    process.env.SQLITE_DB_PATH = path.join(tmpDir, 'test.db');

    const dbMod = await import('../server/core/database.ts');
    initDatabase = dbMod.initDatabase;
    setTestDb = dbMod.setTestDb;
    getDb = dbMod.getDb;
    setTestDb(initDatabase(':memory:'));

    const jobMod = await import('../server/core/jobQueue.ts');
    jobWorker = jobMod.jobWorker;

    const xpMod = await import('../server/services/progress/xpService.ts');
    xpThresholdForLevel = xpMod.xpThresholdForLevel;

    const { createApp } = await import('../server.ts');
    const app = createApp();
    server = app.listen(0);
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports honest rule-based health readiness and level curve math', async () => {
    const h = await reqJson<{ status: string }>('/health');
    expect(h.status).toBe(200);
    expect(h.data.status).toBe('ok');

    const ready = await reqJson<{ ai_mode: string; database: boolean; storage: boolean }>('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.data.ai_mode).toBe('rule_based');
    expect(ready.data.database).toBe(true);
    expect(ready.data.storage).toBe(true);

    expect(xpThresholdForLevel(1)).toBe(0);
    expect(xpThresholdForLevel(2)).toBe(Math.round(100 * Math.pow(2, 1.5)));
    expect(xpThresholdForLevel(3)).toBe(Math.round(100 * Math.pow(3, 1.5)));
  });

  it('handles auth, upload validation, grounded tutor, hidden answer keys, misconceptions, idempotent XP, worlds, and safe deletion', async () => {
    // 1. Register user A & user B
    const regA = await reqJson<{ access_token: string; user: { id: string } }>('/api/auth/register', {
      method: 'POST',
      body: { email: 'alice@edu.test', password: 'password123', full_name: 'Alice' },
    });
    expect(regA.status).toBe(201);
    const tokenA = regA.data.access_token;

    const dupA = await reqJson('/api/auth/register', {
      method: 'POST',
      body: { email: 'alice@edu.test', password: 'password123', full_name: 'Alice' },
    });
    expect(dupA.status).toBe(409);

    const regB = await reqJson<{ access_token: string }>('/api/auth/register', {
      method: 'POST',
      body: { email: 'bob@edu.test', password: 'password123', full_name: 'Bob' },
    });
    const tokenB = regB.data.access_token;

    // 2. Spoofed PDF magic bytes rejected
    const fakePdfForm = new FormData();
    fakePdfForm.append('file', new Blob(['NOT_A_REAL_PDF_CONTENT'], { type: 'application/pdf' }), 'spoof.pdf');
    const spoofRes = await reqJson<{ error: { code: string } }>('/api/documents/upload', {
      method: 'POST',
      token: tokenA,
      body: fakePdfForm,
    });
    expect(spoofRes.status).toBe(415);
    expect(spoofRes.data.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    // 3. Empty TXT fails safely with EMPTY_DOCUMENT
    const emptyTxtForm = new FormData();
    emptyTxtForm.append('file', new Blob(['tiny'], { type: 'text/plain' }), 'empty.txt');
    const emptyUpload = await reqJson<{ document: { id: string } }>('/api/documents/upload', {
      method: 'POST',
      token: tokenA,
      body: emptyTxtForm,
    });
    expect(emptyUpload.status).toBe(202);
    const emptyStatus = await waitForDocReady(emptyUpload.data.document.id, tokenA);
    expect(emptyStatus).toBe('failed');
    const failedDetail = await reqJson<{ document: { error_code: string } }>(
      `/api/documents/${emptyUpload.data.document.id}`,
      { token: tokenA },
    );
    expect(failedDetail.data.document.error_code).toBe('EMPTY_DOCUMENT');

    // 4. Upload real Data Structures notes
    const studyNotes = [
      '# Stack Data Structure',
      'A Stack is a linear data structure that follows the LIFO (Last-In, First-Out) principle.',
      'PUSH adds an element to the top of the stack in O(1) constant time.',
      'POP removes the most recently added element from the top of the stack in O(1) constant time.',
      'For example, browser back-button history and function call stacks rely on LIFO behavior.',
      '',
      '# Queue Data Structure',
      'A Queue is a linear data structure that follows the FIFO (First-In, First-Out) principle.',
      'ENQUEUE inserts a new element at the rear of the queue in O(1) time.',
      'DEQUEUE removes the oldest element from the front of the queue in O(1) time.',
      'For example, print job scheduling and BFS level-order traversal use FIFO queues.',
    ].join('\n');

    const realForm = new FormData();
    realForm.append('file', new Blob([studyNotes], { type: 'text/plain' }), 'ds-notes.txt');
    realForm.append('title', 'Stacks and Queues');
    const uploadRes = await reqJson<{ document: { id: string } }>('/api/documents/upload', {
      method: 'POST',
      token: tokenA,
      body: realForm,
    });
    expect(uploadRes.status).toBe(202);
    const docId = uploadRes.data.document.id;
    const readyStatus = await waitForDocReady(docId, tokenA);
    expect(readyStatus).toBe('ready');

    // 5. Cross-user isolation check
    const bobGet = await reqJson(`/api/documents/${docId}`, { token: tokenB });
    expect(bobGet.status).toBe(404);

    // 6. Inspect extracted topics & chunks
    const docDetail = await reqJson<{
      topics: Array<{ id: string; name: string }>;
      chunks: Array<{ id: string }>;
    }>(`/api/documents/${docId}`, { token: tokenA });
    expect(docDetail.status).toBe(200);
    expect(docDetail.data.topics.length).toBeGreaterThanOrEqual(2);
    expect(docDetail.data.chunks.length).toBeGreaterThanOrEqual(1);

    // 7. Grounded AI Tutor: grounded answer + refusal for out-of-document topic
    const convRes = await reqJson<{ conversation: { id: string } }>('/api/tutor/conversations', {
      method: 'POST',
      token: tokenA,
      body: { title: 'DS Review', document_ids: [docId], explanation_style: 'step_by_step' },
    });
    expect(convRes.status).toBe(201);
    const convId = convRes.data.conversation.id;

    const groundedChat = await reqJson<{
      assistant_message: { grounding: string; sources: Array<{ chunk_id: string }> };
      provider_label: string;
    }>('/api/tutor/chat', {
      method: 'POST',
      token: tokenA,
      body: { conversation_id: convId, message: 'How does POP work on a Stack LIFO?' },
    });
    expect(groundedChat.status).toBe(200);
    expect(groundedChat.data.provider_label).toBe('Rule-Based Engine');
    expect(groundedChat.data.assistant_message.grounding).toBe('document');
    expect(groundedChat.data.assistant_message.sources.length).toBeGreaterThan(0);

    const outOfDocChat = await reqJson<{
      assistant_message: { grounding: string; sources: unknown[] };
    }>('/api/tutor/chat', {
      method: 'POST',
      token: tokenA,
      body: { conversation_id: convId, message: 'Explain quantum chromodynamics quark confinement.' },
    });
    expect(outOfDocChat.status).toBe(200);
    expect(outOfDocChat.data.assistant_message.grounding).toBe('not_in_document');
    expect(outOfDocChat.data.assistant_message.sources.length).toBe(0);

    // 8. Quiz creation hides answer_key & rubric
    const quizRes = await reqJson<{
      assessment: { id: string };
      questions: Array<Record<string, unknown>>;
    }>('/api/assessments', {
      method: 'POST',
      token: tokenA,
      body: { kind: 'diagnostic', document_id: docId, question_count: 4 },
    });
    expect(quizRes.status).toBe(201);
    const assessmentId = quizRes.data.assessment.id;
    for (const q of quizRes.data.questions) {
      expect(q.answer_key).toBeUndefined();
      expect(q.rubric).toBeUndefined();
    }

    // 9. Misconception confirmation on >=2 occurrences + corrective resolution
    const q0 = quizRes.data.questions[0];
    const q1 = quizRes.data.questions[1] || q0;

    // Submit wrong answer 1 on Stack/Queue confusion
    const wrong1 = await reqJson<{
      student_answer: { is_correct: boolean };
      diagnosis: { thread: { id: string; status: string; occurrences: number } };
    }>(`/api/assessments/${assessmentId}/answers`, {
      method: 'POST',
      token: tokenA,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        question_id: q0.id,
        answer: 'The oldest element at the bottom/front (FIFO — First-In, First-Out).',
      },
    });
    expect(wrong1.status).toBe(200);
    expect(wrong1.data.student_answer.is_correct).toBe(false);
    expect(wrong1.data.diagnosis.thread.status).toBe('suspected');

    // Submit a second wrong answer on another quiz for the same Stack LIFO topic to trigger confirmed
    const quiz2Res = await reqJson<{
      assessment: { id: string };
      questions: Array<{ id: string; topic_id: string; prompt: string }>;
    }>('/api/assessments', {
      method: 'POST',
      token: tokenA,
      body: { kind: 'practice', topic_ids: [String(q0.topic_id)], question_count: 2 },
    });
    const q2 = quiz2Res.data.questions[0];
    const wrong2 = await reqJson<{
      diagnosis: { thread: { id: string; status: string; occurrences: number } };
    }>(`/api/assessments/${quiz2Res.data.assessment.id}/answers`, {
      method: 'POST',
      token: tokenA,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        question_id: q2.id,
        answer: 'FIFO oldest front dequeue queue',
      },
    });
    expect(wrong2.status).toBe(200);
    expect(wrong2.data.diagnosis.thread.occurrences).toBeGreaterThanOrEqual(2);
    expect(wrong2.data.diagnosis.thread.status).toBe('confirmed');

    // Resolve the confirmed misconception via corrective-answer
    const threadId = wrong2.data.diagnosis.thread.id;
    const threadDetail = await reqJson<{
      follow_up_assessment_id: string;
      follow_up_question: { id: string };
    }>(`/api/misconceptions/${threadId}`, { token: tokenA });
    const fqRow = getDb()
      .prepare('SELECT answer_key FROM questions WHERE id = ?')
      .get(threadDetail.data.follow_up_question.id) as { answer_key: string };
    const expectedCorrect = JSON.parse(fqRow.answer_key).correct as string;

    const resolveRes = await reqJson<{
      is_correct: boolean;
      thread: { status: string };
      xp_award: { amount: number };
    }>(`/api/misconceptions/${threadId}/corrective-answer`, {
      method: 'POST',
      token: tokenA,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        question_id: threadDetail.data.follow_up_question.id,
        answer: expectedCorrect,
      },
    });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.data.is_correct).toBe(true);
    expect(resolveRes.data.thread.status).toBe('resolved');
    expect(resolveRes.data.xp_award.amount).toBe(35);

    // 10. Idempotent XP award & 409 conflict on mismatched payload/endpoint
    await reqJson(`/api/assessments/${assessmentId}/answers`, {
      method: 'POST',
      token: tokenA,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { question_id: q1.id, answer: 'True' },
    });

    const idemKey = 'idem-complete-quiz-1';
    const comp1 = await reqJson<{ xp_award: { amount: number } }>(
      `/api/assessments/${assessmentId}/complete`,
      { method: 'POST', token: tokenA, headers: { 'Idempotency-Key': idemKey } },
    );
    expect(comp1.status).toBe(200);

    const statsAfter1 = await reqJson<{ stats: { total_xp: number } }>('/api/progress/stats', {
      token: tokenA,
    });
    const xpBeforeReplay = statsAfter1.data.stats.total_xp;

    // Replay same Idempotency-Key -> same response, zero duplicate XP
    const compReplay = await reqJson<{ xp_award: { amount: number } }>(
      `/api/assessments/${assessmentId}/complete`,
      { method: 'POST', token: tokenA, headers: { 'Idempotency-Key': idemKey } },
    );
    expect(compReplay.status).toBe(200);

    const statsAfterReplay = await reqJson<{ stats: { total_xp: number } }>('/api/progress/stats', {
      token: tokenA,
    });
    expect(statsAfterReplay.data.stats.total_xp).toBe(xpBeforeReplay);

    // Reusing key on different endpoint -> 409
    const conflictRes = await reqJson('/api/quests/fake-quest/complete', {
      method: 'POST',
      token: tokenA,
      headers: { 'Idempotency-Key': idemKey },
    });
    expect(conflictRes.status).toBe(409);

    // 11. Worlds & Boss lock enforcement
    const worldsRes = await reqJson<{
      items: Array<{ id: string; quests: Array<{ id: string; kind: string; is_unlocked: boolean }> }>;
    }>('/api/worlds', { token: tokenA });
    expect(worldsRes.data.items.length).toBeGreaterThanOrEqual(1);
    const bossQuest = worldsRes.data.items[0].quests.find((q) => q.kind === 'boss')!;
    expect(bossQuest.is_unlocked).toBe(false);

    const lockedBossStart = await reqJson(`/api/quests/${bossQuest.id}/start`, {
      method: 'POST',
      token: tokenA,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(lockedBossStart.status).toBe(403);

    // 12. Deleting document preserves XP, mastery, and misconceptions
    const delRes = await reqJson(`/api/documents/${docId}`, { method: 'DELETE', token: tokenA });
    expect(delRes.status).toBe(204);

    const analyticsAfterDelete = await reqJson<{
      stats: { total_xp: number };
      summary: { resolved_misconceptions: number };
      topic_mastery: unknown[];
    }>('/api/analytics/overview', { token: tokenA });
    expect(analyticsAfterDelete.status).toBe(200);
    expect(analyticsAfterDelete.data.stats.total_xp).toBe(xpBeforeReplay);
    expect(analyticsAfterDelete.data.summary.resolved_misconceptions).toBeGreaterThanOrEqual(1);
    expect(analyticsAfterDelete.data.topic_mastery.length).toBeGreaterThanOrEqual(1);
  });

  it('filters administrative cover templates, builds structured practical study notes, and validates 4-option MCQs', async () => {
    const reg = await reqJson<{ access_token: string }>('/api/auth/register', {
      method: 'POST',
      body: { email: 'matlab@edu.test', password: 'password123', full_name: 'Lab Student' },
    });
    expect(reg.status).toBe(201);
    const token = reg.data.access_token;

    // 1. Admin-only form document should mark unsuitable and never generate admin quiz questions
    const adminOnly = [
      'BCS-305 | IT Workshop (Scilab/MATLAB) Laboratory',
      'COMPLETE PRACTICAL RECORD (EXPERIMENTS 1 - 12)',
      'Name of Student: ________________________________',
      'Roll No.: __________________ Semester: ____________',
      'Department: ______________________________________',
      'Academic Session: ________________________________',
      'Institution: _____________________________________',
    ].join('\n');

    const adminForm = new FormData();
    adminForm.append('file', new Blob([adminOnly], { type: 'text/plain' }), 'cover-only.txt');
    const adminUp = await reqJson<{ document: { id: string } }>('/api/documents/upload', {
      method: 'POST',
      token,
      body: adminForm,
    });
    expect(adminUp.status).toBe(202);
    expect(await waitForDocReady(adminUp.data.document.id, token)).toBe('ready');

    const adminDetail = await reqJson<{
      topics: unknown[];
      analysis: { study_notes: { unsuitable_reason: string | null } };
    }>(`/api/documents/${adminUp.data.document.id}`, { token });
    expect(adminDetail.data.topics.length).toBe(0);
    expect(adminDetail.data.analysis.study_notes.unsuitable_reason).toBeTruthy();

    const adminQuizAttempt = await reqJson('/api/assessments', {
      method: 'POST',
      token,
      body: { kind: 'diagnostic', document_id: adminUp.data.document.id, question_count: 5 },
    });
    expect(adminQuizAttempt.status).toBe(422);

    // 2. Practical lab material with admin header noise + genuine experiments & commands
    const practicalDoc = [
      'BCS-305 | IT Workshop (Scilab/MATLAB) Laboratory',
      'Name of Student: ________________________________',
      'Roll No.: __________________',
      '',
      'EXPERIMENT 1: INTRODUCTION TO MATLAB',
      'AIM: To study the MATLAB Desktop, Command Window, Workspace and semicolon output suppression.',
      'Theory / Introduction: MATLAB is a numerical computing environment. An unassigned expression result is stored in MATLAB default variable ans.',
      '1.1 Use of Semicolon (;)',
      'Theory: A semicolon suppresses display of a statement result.',
      'MATLAB Program:',
      'clc; clear;',
      'x=10',
      'y=20;',
      'Sample Output:',
      'x = 10',
      'RESULT: Basic commands and semicolon suppression were verified.',
      '',
      'EXPERIMENT 2: CONVOLUTION AND MATRIX OPERATORS',
      'AIM: To implement linear convolution using conv() and element-wise multiplication using .*.',
      'Theory / Introduction: For finite sequences of lengths L and M, output length of conv(x,h) is L+M-1. The operator .* multiplies corresponding elements of equal-sized arrays.',
      '2.1 Linear Convolution Using conv()',
      'Theory: conv(x,h) calculates linear convolution of two sequences.',
      'MATLAB Program:',
      'x=[1 2 3]; h=[1 1 1];',
      'y=conv(x,h);',
      'Sample Output:',
      '1 3 6 5 3',
      'RESULT: Convolution and element-wise multiplication executed cleanly.',
      '',
      'IMPORTANT MATLAB COMMANDS',
      'clc Clears Command Window.',
      'clear Removes Workspace variables.',
      'conv() Calculates linear convolution.',
      'plot() Creates a 2-D plot.',
      'stem() Creates a discrete-time plot.',
      'SUGGESTED VIVA QUESTIONS',
      '1. What is the difference between * and .*?',
      '2. What is the use of semicolon (;) in MATLAB?',
    ].join('\n');

    const labForm = new FormData();
    labForm.append('file', new Blob([practicalDoc], { type: 'text/plain' }), 'matlab-lab.txt');
    labForm.append('title', 'MATLAB Practical Guide');
    const labUp = await reqJson<{ document: { id: string } }>('/api/documents/upload', {
      method: 'POST',
      token,
      body: labForm,
    });
    expect(labUp.status).toBe(202);
    expect(await waitForDocReady(labUp.data.document.id, token)).toBe('ready');

    const labDetail = await reqJson<{
      topics: Array<{ name: string; kind: string }>;
      analysis: {
        summary: string;
        study_notes: {
          kind: string;
          practical_experiments: Array<{ title: string }>;
          commands_reference: Array<{ command: string; purpose: string }>;
          viva_questions: string[];
        };
      };
    }>(`/api/documents/${labUp.data.document.id}`, { token });

    expect(labDetail.data.analysis.study_notes.kind).toBe('practical');
    expect(labDetail.data.analysis.study_notes.practical_experiments.length).toBeGreaterThanOrEqual(2);
    expect(labDetail.data.analysis.study_notes.commands_reference.length).toBeGreaterThanOrEqual(4);
    expect(labDetail.data.analysis.study_notes.viva_questions.length).toBeGreaterThanOrEqual(2);
    for (const t of labDetail.data.topics) {
      expect(t.name).not.toMatch(/Name of Student|Roll No|Institution|BCS-305/i);
    }

    const labQuiz = await reqJson<{
      assessment: { id: string };
      questions: Array<{ id: string; type: string; prompt: string; options: string[] }>;
    }>('/api/assessments', {
      method: 'POST',
      token,
      body: { kind: 'diagnostic', document_id: labUp.data.document.id, question_count: 6 },
    });
    expect(labQuiz.status).toBe(201);
    expect(labQuiz.data.questions.length).toBeGreaterThanOrEqual(4);

    for (const q of labQuiz.data.questions) {
      expect(q.prompt).not.toMatch(/Name of Student|Roll No|Institution|___/);
      if (q.type === 'mcq') {
        expect(q.options.length).toBe(4);
        const uniqueOpts = new Set(q.options.map((o) => o.trim().toLowerCase()));
        expect(uniqueOpts.size).toBe(4);
        for (const opt of q.options) {
          expect(opt.trim().length).toBeGreaterThan(0);
          expect(opt.length).toBeLessThanOrEqual(165);
          expect(opt).not.toMatch(/___/);
        }
      }
    }
  });
});
